import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { parseCreativeDesign } from "@/lib/ai/courseware-creative-design";
import { resolveCourseDesign } from "@/lib/ai/courseware-design";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";
import { CoursePresentationMutationLostError, renderAndStoreLessonHtml, createCoursewareBudget } from "@/lib/ai/courseware-gen";
import { beginCoursePresentationMutation, settleExternalCoursePresentation } from "@/lib/course-gen";
import {
  completeCoursePresentationOperation,
  coursePresentationOperationExists,
  coursePresentationPayloadHash,
  reconcileCoursePresentationOperationFailure,
  recordCoursePresentationDesignSnapshot,
  recordCoursePresentationRevision,
  recordCoursePresentationThemeUsage,
  runCoursePresentationOperationStage,
  startCoursePresentationOperation,
  type CoursePresentationOperation,
} from "@/lib/course-presentation-operation";
import { ensureRequestId } from "@/lib/request-id";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      courseId?: string;
      lessonId?: string;
      requestId?: string;
    } | null;
    if (body?.lessonId) return fail("课级皮肤必须应用到整门课，不支持单节套皮", 400);
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少 courseId");
    const requestId = ensureRequestId(body?.requestId);
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        category: true,
        template: true,
        designJson: true,
        customThemeId: true,
        authorUserId: true,
      },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权修改该课程", 403);
    const lessons = await prisma.lesson.findMany({
      where: { courseId, blocksJson: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, title: true, summary: true, sortOrder: true, blocksJson: true, htmlJson: true,
        renderSourceHash: true, renderEngine: true, designJson: true,
      },
    });
    const existingRequest = await coursePresentationOperationExists(courseId, requestId);
    if (!existingRequest) {
      // 限流和禁用闸必须在创建 GenerationJob 之前。否则攻击者可换
      // requestId，让每个 429/503 仍落一条 failed job + reversal 墓碑。
      assertUserRateLimit(user.id, "creator_theme_apply", 30, 3_600_000);
      if (!customThemeLlmApplicationEnabled()) {
        return fail("整课 AI 主题应用正在升级总预算保护，暂不可用", 503);
      }
    }
    const started = await startCoursePresentationOperation({
      userId: user.id,
      courseId,
      requestId,
      kind: "custom_theme",
      payload: { courseId, themeId: id },
      targetLessonIds: lessons.map((lesson) => lesson.id),
      themeId: id,
      targetSnapshotHash: coursePresentationPayloadHash(lessons),
    });
    if (started.status === "replay") return ok(started.response);
    if (started.status === "running") return fail("相同 requestId 的主题操作仍在进行，请稍后用原 requestId 重试", 409);
    if (started.status === "busy") return fail("另一课件操作正在进行，请等待完成后再试", 409);
    if (started.status === "failed") return fail("该 requestId 对应主题操作已失败且积分已冲正，请用新 requestId 重试", 409);
    let operation: CoursePresentationOperation = started.operation;

    try {
      // 资损止血：整课主题可触发每节多次供应商调用。在 operation-level
      // 原子总预占+子调用结算落地前，单次余额预检可被“前几节成功、
      // 后几节余额不足回落、整组冲正”循环套利。已完成 requestId 仍在上方正常回放；
      // 新 acquired 在任何预占/fetch 前收敛 failed。
      if (!customThemeLlmApplicationEnabled()) {
        throw new AppError("整课 AI 主题应用正在升级总预算保护，暂不可用", 503, false);
      }

      // 资损闸门：皮肤可用性、限流、订阅和余额只对首次 acquired 执行。
      // done 丢包回放只依赖当前课程仍归该用户，不会因皮肤后续删除/转私有或
      // 当前余额、订阅变化而拒绝原响应。
      const theme = await prisma.theme.findUnique({ where: { id } });
      if (!theme) throw new AppError("皮肤不存在", 404, false);
      if (theme.ownerId !== user.id && !(theme.visibility === "public" && theme.status === "published")) {
        throw new AppError("无权使用该皮肤", 403, false);
      }
      const creative = parseCreativeDesign(theme.tokensJson);
      if (!creative) throw new AppError("皮肤未通过当前安全与可读性校验", 422, false);
      const snapshot = await resolveEntitlement(user.id);
      if (!snapshot.canUseLLM) throw new AppError("AI 精修排版需订阅后使用", 402);
      await assertCanSpend(user.id, "generate_lesson_html");
      operation = await recordCoursePresentationDesignSnapshot(operation, {
        priorCustomThemeId: course.customThemeId,
        priorLessonDesigns: lessons.map((lesson) => ({ lessonId: lesson.id, designJson: lesson.designJson })),
      });

      const mutation = await runCoursePresentationOperationStage(operation, () =>
        beginCoursePresentationMutation(courseId, { ownerPresentationLease: operation.lease }));
      if (!mutation.ok) {
        await reconcileCoursePresentationOperationFailure(operation);
        if (mutation.reason === "faithful_import") return fail("忠实导入课件不能用普通主题覆盖", 409);
        if (mutation.reason === "archived") return fail("已归档课程不能应用主题", 409);
        if (mutation.reason === "active_generation") return fail("课程正在生成或暂停中，请先等待任务收敛", 409);
        return fail("课程暂无可重排的课节", mutation.reason === "not_found" ? 404 : 400);
      }
      operation = await recordCoursePresentationRevision(operation, mutation.revision);

      const courseDesign = resolveCourseDesign(course);
      const mode = resolveCoursewareMode({ title: course.title, template: course.template });
      const { rendered, fallback } = await runCoursePresentationOperationStage(operation, async () => {
        await prisma.$transaction(async (tx) => {
          const courseStored = await tx.course.updateMany({
            where: { id: courseId, presentationRevision: mutation.revision, genStatus: "failed" },
            data: { customThemeId: theme.id, lastUpdatedAt: new Date() },
          });
          if (courseStored.count !== 1) throw new CoursePresentationMutationLostError();
          await tx.lesson.updateMany({
            where: { courseId, id: { in: lessons.map((lesson) => lesson.id) } },
            data: { designJson: theme.tokensJson },
          });
        });

        let renderedCount = 0;
        let fallbackCount = 0;
        const budget = createCoursewareBudget();
        for (const lesson of lessons) {
          const result = await renderAndStoreLessonHtml(
            courseId,
            { ...lesson, designJson: theme.tokensJson },
            courseDesign,
            mode,
            {
              enhance: true,
              userId: user.id,
              courseTitle: course.title,
              category: course.category,
              budget,
              force: true,
              presentationRevision: mutation.revision,
              billingKey: `presentation-op:${operation.operationKey}:${lesson.id}`,
              billingOperationKey: operation.operationKey,
            },
          );
          if (result.engine === "llm") renderedCount += 1;
          else if (result.engine === "deterministic") fallbackCount += 1;
        }
        return { rendered: renderedCount, fallback: fallbackCount };
      });

      const presentation = await runCoursePresentationOperationStage(operation, () =>
        settleExternalCoursePresentation(courseId, mutation.revision));
      if (!presentation.settled) throw new CoursePresentationMutationLostError();
      if (!presentation.contentReady || presentation.status === "incomplete" || fallback > 0 || rendered !== lessons.length) {
        // 自定义 token 尚未安全映射到确定性 renderer；fallback 只代表通用基础排版。
        // 先用当前 revision CAS 摘掉发布态，外层失败收敛再整组冲正所有已结算调用。
        await prisma.course.updateMany({
          where: { id: courseId, presentationRevision: mutation.revision },
          data: { genStatus: "failed" },
        });
        throw new AppError(`主题课件未完整交付（${presentation.ready}/${presentation.total}），本次积分已冲正`, 409);
      }

      // 用量与 operation 快照同事务 exactly-once 落库；崩溃恢复会补记但不重复增加。
      operation = await recordCoursePresentationThemeUsage(operation);
      const response = {
        themeId: theme.id,
        affected: lessons.length,
        rendered,
        fallback,
        presentationStatus: presentation.status === "ready" ? "premium" : "degraded",
      };
      await completeCoursePresentationOperation(operation, response);
      return ok(response);
    } catch (error) {
      const reconciliation = await reconcileCoursePresentationOperationFailure(operation);
      if (reconciliation.status === "replay") return ok(reconciliation.response);
      if (error instanceof CoursePresentationMutationLostError) {
        return fail("已有新的主题操作，本次结果已丢弃且积分已冲正", 409);
      }
      throw error;
    }
  });
}

/** 重新开启的必要条件：operation-level 原子总预占+子调用结算+快照指纹重验。 */
function customThemeLlmApplicationEnabled(): boolean {
  return false;
}
