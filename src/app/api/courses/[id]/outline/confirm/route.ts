import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { claimCourseGenerationStart, finishGenJobLeaseOnly, initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { createCourseContentBrief } from "@/lib/ai/content-brief";
import { sourcePolicyForFinalCourseOutline } from "@/lib/ai/source-policy";
import { resolveCourseSourceTruth } from "@/lib/ai/course-source-truth";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/outline/confirm —— L2 可控造课：确认大纲，开始逐节生成。
 *
 * 把 outline_draft 的课转成 generating，建进度 job，注册 after() 后台扇出（与首次造课收尾一致）。
 * 逐节扇出成本由 runCourseGenBackground 的逐节积分门按实时余额兜底；此处按课级模型再做一次预检
 * （与 resume-gen 一致），避免用户多次重生成大纲后余额已不足、确认后立刻落 failed。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId + genStatus==='outline_draft'。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    // 权益 + 限流。独立作用域（2026-07-20 修复）：确认是「已获准的那次造课」的第二步，
    // 此前与 generate-course 共用 ai_gen_course 5/天——专业模式一门课吃 2 次配额，两门即锁死。
    assertUserRateLimit(user.id, "ai_outline_confirm", 20, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    const course = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        authorUserId: true,
        status: true,
        genStatus: true,
        modelUsed: true,
        category: true,
        origin: true,
        blueprintJson: true,
        contentBriefJson: true,
        presentationRevision: true,
        lessons: {
          orderBy: { sortOrder: "asc" },
          select: { title: true, summary: true },
        },
      },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.status === "archived") return fail("已归档课程不能确认生成", 409);
    if (course.genStatus !== "outline_draft") {
      return fail("该课程不在大纲待确认状态", 409);
    }

    // 直接 confirm 也必须用已持久化的最终课名/章节/来源重算硬门，
    // 不能依赖 PATCH 曾经跑过，也不接受请求临时声称有来源。
    const sourceTruth = await resolveCourseSourceTruth(course);
    if (sourceTruth.requiresActualSource && !sourceTruth.hasActualSource) {
      return fail("导入课程的原始资料已丢失或未解析完成，无法开始生成", 422);
    }
    const brief = sourceTruth.contentBrief
      ?? createCourseContentBrief({ request: course.title, requestProvenance: "course_title" });
    const sourceGate = sourcePolicyForFinalCourseOutline({
      courseTitle: course.title,
      originalRequest: brief.request,
      lessons: course.lessons,
      category: course.category,
      sourceAvailable: sourceTruth.hasActualSource,
      persistedSourceAsOf: sourceTruth.trustedSourceAsOf,
      actualSourceText: sourceTruth.actualSourceText,
    });
    if (sourceGate.missingSource) {
      return fail(`${sourceGate.reason ?? "该主题需要外部真值"}，请先提供可核查的一手或官方参考资料`, 422);
    }
    if (sourceGate.missingAsOfDate) {
      return fail("该主题包含最新/当前信息，请在课程标题、原始需求或课节中写明截至日期（例如：截至 2026-08-12）", 422);
    }

    // 课级模型的余额预检（不对非作者做扣费预检——归属已在上方校验）。
    await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

    const total = await prisma.lesson.count({ where: { courseId: course.id } });
    if (total === 0) return fail("大纲为空，请先补充章节", 400);

    const lease = await initGenJob(course.id, user.id, total, { category: course.category ?? undefined });
    if (!lease) return fail("该课程已有生成任务在运行", 409);
    const started = await claimCourseGenerationStart({
      courseId: course.id,
      userId: user.id,
      lease,
      expectedGenStatus: "outline_draft",
      expectedPresentationRevision: course.presentationRevision,
    });
    if (!started) {
      await finishGenJobLeaseOnly(lease, "outline confirmation state changed");
      return fail("课程大纲状态已变更，请刷新后重试", 409);
    }

    const courseId = course.id;
    after(async () => {
      await runCourseGenBackground(courseId, user.id, lease);
    });

    return ok({ confirmed: true, genStatus: "generating", total });
  });
}
