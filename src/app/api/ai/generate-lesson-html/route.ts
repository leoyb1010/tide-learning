import { NextRequest, NextResponse } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLessonGenAccess } from "@/lib/ai-guard";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { selectModelFor } from "@/lib/ai/models";
import { CoursePresentationMutationLostError, generateLessonHtml } from "@/lib/ai/courseware-gen";
import {
  assessLessonPresentationRefinePreflight,
  beginCoursePresentationMutation,
  settleExternalCoursePresentation,
} from "@/lib/course-gen";
import {
  completeCoursePresentationOperation,
  coursePresentationOperationExists,
  reconcileCoursePresentationOperationFailure,
  recordCoursePresentationRevision,
  runCoursePresentationOperationStage,
  startCoursePresentationOperation,
  type CoursePresentationOperation,
} from "@/lib/course-presentation-operation";
import { ensureRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate-lesson-html —— v3.3 把一节的块课件升级为「多样化 HTML 课件」。
 *
 * body: { lessonId, enhance?: boolean, model?: string, requestId }
 * - 默认 enhance=true：设计 Agent 为本节原创 OKLCH token，强模型生成自包含 HTML。
 * - 仅安全、宿主协议与对比度是硬门；失败重做一次，仍失败才回落确定性安全网。
 * - enhance=false 是显式的低成本逃生门，不再是默认质量路径。
 * 限流：每用户每小时 60 节。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);

    // 鉴权先于任何业务 DB 触达；付费限流只对首次 acquired 执行。
    const preUser = await requireUser();

    const body = (await req.json().catch(() => null)) as {
      lessonId?: string;
      enhance?: boolean;
      model?: string;
      requestId?: string;
    } | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");

    // 用户只能处理自己名下的课；模型档位仍由权益过滤，但原创表现层不再被会员开关关闭。
    const target = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true, course: { select: { id: true, authorUserId: true } } },
    });
    if (!target) return fail("章节不存在", 404);
    // requireLessonGenAccess 对有订阅用户只验权益，不等于作者归属。
    // 必须在权益/余额预检与 begin 的任何 DB 写前用已验证会话显式 403。
    if (target.course?.authorUserId !== preUser.id) throw new AppError("无权操作该课程", 403);
    const requestId = ensureRequestId(body?.requestId);
    const existingRequest = await coursePresentationOperationExists(target.courseId, requestId);
    if (!existingRequest) {
      // 新请求先过只读交付前置门和公网限流，再创建 operation。
      // 否则攻击者可换 requestId，让每个必然失败/429 仍落
      // failed job + reversal 墓碑。已有请求跳过这两门，保证丢包回放。
      const preflight = await assessLessonPresentationRefinePreflight(target.courseId, lessonId);
      if (!preflight.ok) {
        return fail("整课内容或其他课节的课件尚未就绪，请先完成课程再精修本节", 409);
      }
      assertUserRateLimit(preUser.id, "ai_gen_lesson_html", 60, 3_600_000);
    }
    const started = await startCoursePresentationOperation({
      userId: preUser.id,
      courseId: target.courseId,
      requestId,
      kind: "lesson_html",
      payload: {
        lessonId,
        enhance: body?.enhance !== false,
        model: body?.model?.trim() || null,
      },
      targetLessonIds: [lessonId],
    });
    if (started.status === "replay") return ok(started.response);
    if (started.status === "running") return fail("相同 requestId 的课件精修仍在进行，请稍后用原 requestId 重试", 409);
    if (started.status === "busy") {
      const sameLesson = started.activeRequestId !== null && started.activeKind === "lesson_html" &&
        started.activeTargetLessonIds.length === 1 && started.activeTargetLessonIds[0] === lessonId;
      return NextResponse.json({
        ok: false,
        error: sameLesson
          ? "本节课件已在另一标签页精修，请稍后重试原操作"
          : "另一课件操作正在进行，请等待完成后再试",
        data: {
          code: "COURSE_PRESENTATION_BUSY",
          activeRequestId: sameLesson ? started.activeRequestId : null,
          kind: started.activeKind,
          targets: started.activeTargetLessonIds,
        },
      }, { status: 409 });
    }
    if (started.status === "failed") return fail("该 requestId 对应操作已失败且积分已冲正，请用新 requestId 重试", 409);
    let operation: CoursePresentationOperation = started.operation;

    try {
      const { user, snapshot } = await requireLessonGenAccess(target.course.authorUserId, {
        spendScene: "generate_lesson_html",
      });
      // 按当前用户档位钳制模型，仅首次真正执行需要当前权益/余额。
      const allowedModel = selectModelFor(body?.model?.trim() || null, snapshot.canUseLLM);
      const mutation = await runCoursePresentationOperationStage(operation, () =>
        beginCoursePresentationMutation(target.courseId, {
          lessonIds: [lessonId],
          ownerPresentationLease: operation.lease,
        }));
      if (!mutation.ok) {
        await reconcileCoursePresentationOperationFailure(operation);
        if (mutation.reason === "faithful_import") return fail("忠实导入课件不能用 AI 重渲覆盖", 409);
        if (mutation.reason === "archived") return fail("已归档课程不能重渲", 409);
        if (mutation.reason === "active_generation") return fail("课程正在生成或暂停中，请先等待任务收敛", 409);
        return fail("课节不存在或暂无可重渲内容", mutation.reason === "not_found" ? 404 : 400);
      }
      operation = await recordCoursePresentationRevision(operation, mutation.revision);

      const result = await runCoursePresentationOperationStage(operation, () =>
        generateLessonHtml(lessonId, user.id, {
          enhance: body?.enhance !== false,
          model: allowedModel?.key ?? null,
          presentationRevision: mutation.revision,
          billingOperationKey: operation.operationKey,
        }));
      if (!result.ok) throw new AppError("本节尚无内容块，请先生成块课件再升级为 HTML 课件", 409);

      const presentation = await runCoursePresentationOperationStage(operation, () =>
        settleExternalCoursePresentation(target.courseId, mutation.revision));
      if (!presentation.settled) throw new CoursePresentationMutationLostError();
      if (!presentation.contentReady || presentation.status === "incomplete") {
        throw new AppError(`课件未完整交付（${presentation.ready}/${presentation.total}），课程已保持为不可发布状态`, 409);
      }
      const response = {
        lessonId,
        engine: result.engine,
        presentationStatus: presentation.status === "ready" ? "premium" : "degraded",
      };
      await completeCoursePresentationOperation(operation, response);
      return ok(response);
    } catch (e) {
      const reconciliation = await reconcileCoursePresentationOperationFailure(operation);
      if (reconciliation.status === "replay") return ok(reconciliation.response);
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      if (e instanceof CoursePresentationMutationLostError) return fail("已有新的课件重渲操作，本次结果已丢弃且积分已冲正", 409);
      throw e;
    }
  });
}
