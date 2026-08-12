import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLessonGenAccess } from "@/lib/ai-guard";
import { selectModelFor } from "@/lib/ai/models";
import { claimCourseGenerationStart, failGenJobLease, finishGenJobLeaseOnly, generateLessonCore, initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { sourcePolicyForFinalCourseOutline } from "@/lib/ai/source-policy";
import { resolveCourseSourceTruth } from "@/lib/ai/course-source-truth";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/regenerate-lesson —— L4 可控造课：对已生成的一节按指令定向重造。
 *
 * body: { lessonId, instruction?, model? }
 * - regen 模式跑 generateLessonCore（跳过「已生成即返回」短路，按 genClaimedAt 认领防并发双写）。
 * - instruction（≤200 字）拼进 prompt 定向修正；model 覆盖须经会员档 selectModelFor 过滤（越档取用挡在此）。
 * - writeLessonBlocks 自动把旧版存入 LessonRevision（后悔药）、清派生 HTML、shared 课回 pending 重审。
 * - 成稿后 after() 里补渲 HTML 课件（幂等，仅改动节因源哈希变化而真重渲），避免回落旧块渲染。
 * 计费：按真实 token 记 generate_lesson；权益：requireLessonGenAccess（自己名下课放行，spendScene 预检）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);

    const preUser = await requireUser();
    assertUserRateLimit(preUser.id, "ai_gen_lesson", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as
      | { lessonId?: string; instruction?: string; model?: string }
      | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");
    const instruction = typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 200) : undefined;

    // 归属 + 权益（自己名下课放行逐节流水；spendScene 按 generate_lesson 最坏成本预检）。
    const target = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        title: true,
        blocksJson: true,
        courseId: true,
        course: { select: {
          authorUserId: true,
          status: true,
          genStatus: true,
          presentationRevision: true,
          title: true,
          category: true,
          origin: true,
          blueprintJson: true,
          contentBriefJson: true,
        } },
      },
    });
    // 越权铁律：显式归属校验前置于任何状态回显（requireLessonGenAccess 对会员不校归属，仅靠内核 403 兜底，
    // 但下方 409「尚未生成」会先于内核暴露他人课节的存在/状态——故在此显式挡住，闭合信息回显口子）。
    if (!target) return fail("章节不存在", 404);
    if (target.course?.authorUserId !== preUser.id) throw new AppError("无权操作该课程", 403);
    if (target.course.status === "archived") return fail("已归档课程不能重造课节", 409);
    if (target.course.genStatus === "outline_draft") return fail("请先确认课程大纲再重造课节", 409);
    // 空节是无需任何付费能力即可确定的结构错误，必须先于权益/余额预检。
    if (!target.blocksJson) return fail("本节尚未生成，请先生成再重造", 409);

    const sourceTruth = await resolveCourseSourceTruth({ ...target.course, id: target.courseId });
    if (sourceTruth.requiresActualSource && !sourceTruth.hasActualSource) {
      return fail("导入课程的原始资料已丢失或未解析完成，无法重造课节", 422);
    }
    const brief = sourceTruth.contentBrief;
    const sourceGate = sourcePolicyForFinalCourseOutline({
      courseTitle: target.course.title,
      originalRequest: brief?.request ?? target.course.title,
      lessons: [{ title: target.title, summary: instruction ?? null }],
      category: target.course.category,
      sourceAvailable: sourceTruth.hasActualSource,
      persistedSourceAsOf: sourceTruth.trustedSourceAsOf,
      trustedDateText: instruction ?? null,
      actualSourceText: sourceTruth.actualSourceText,
    });
    if (sourceGate.missingSource) {
      return fail("该重造指令涉及快变或高风险事实，请先为课程提供可核查的一手/官方资料", 422);
    }
    if (sourceGate.missingAsOfDate) {
      return fail("该重造指令涉及最新/当前信息，请先在课程需求中明确截至日期", 422);
    }
    const { user, snapshot } = await requireLessonGenAccess(target.course.authorUserId, {
      spendScene: "generate_lesson",
    });

    // 模型覆盖按会员档过滤：非会员/未配额请求高级模型 → 回落（allowedModel=null → 用课级模型）。
    const allowedModel = selectModelFor(body?.model?.trim() || null, snapshot.canUseLLM);
    const total = await prisma.lesson.count({ where: { courseId: target.courseId } });
    const lease = await initGenJob(target.courseId, user.id, total, {}, { allowCompletedReopen: true });
    if (!lease) return fail("该课程正在生成中，请稍后重试", 409);
    const started = await claimCourseGenerationStart({
      courseId: target.courseId,
      userId: user.id,
      lease,
      expectedGenStatus: target.course.genStatus,
      expectedPresentationRevision: target.course.presentationRevision,
    });
    if (!started) {
      await finishGenJobLeaseOnly(lease, "lesson regeneration state changed");
      return fail("该课程状态已变更，请刷新后重试", 409);
    }

    let result;
    try {
      result = await generateLessonCore(lessonId, user.id, {
        regen: true,
        instruction,
        model: allowedModel?.key,
        jobLease: lease,
      });
    } catch (e) {
      await failGenJobLease(
        target.courseId,
        lease,
        e instanceof Error ? e.message : "lesson regeneration failed",
        { genStatus: "generating" },
      );
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      throw e;
    }

    // 内容已改 → HTML 派生层被 writeLessonBlocks 清空；后台补渲，让学员端拿到新版精品课件而非回落块渲染。

    const data = { lessonId, ...result };
    if (!result.ok || result.failed) {
      await failGenJobLease(target.courseId, lease, "lesson regeneration quality gate failed", { genStatus: "generating" });
      return NextResponse.json(
        { ok: false, error: "本节重造后仍未通过质量检查，请调整指令后重试", data },
        { status: 422 },
      );
    }
    after(() => runCourseGenBackground(target.courseId, user.id, lease));
    return ok(data);
  });
}
