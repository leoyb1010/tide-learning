import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLessonGenAccess } from "@/lib/ai-guard";
import { selectModelFor } from "@/lib/ai/models";
import { generateLessonCore, renderCourseHtmlBestEffort } from "@/lib/course-gen";

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
      select: { blocksJson: true, course: { select: { authorUserId: true } } },
    });
    const { user, snapshot } = await requireLessonGenAccess(target?.course?.authorUserId, {
      spendScene: "generate_lesson",
    });

    // 越权铁律：显式归属校验前置于任何状态回显（requireLessonGenAccess 对会员不校归属，仅靠内核 403 兜底，
    // 但下方 409「尚未生成」会先于内核暴露他人课节的存在/状态——故在此显式挡住，闭合信息回显口子）。
    if (target && target.course?.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    // 重造的前提是本节已有内容（对空节应走首次生成 generate-lesson，而非 regen）。
    if (target && !target.blocksJson) return fail("本节尚未生成，请先生成再重造", 409);

    // 模型覆盖按会员档过滤：非会员/未配额请求高级模型 → 回落（allowedModel=null → 用课级模型）。
    const allowedModel = selectModelFor(body?.model?.trim() || null, snapshot.canUseLLM);

    let result;
    try {
      result = await generateLessonCore(lessonId, user.id, {
        regen: true,
        instruction,
        model: allowedModel?.key,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      throw e;
    }

    // 内容已改 → HTML 派生层被 writeLessonBlocks 清空；后台补渲，让学员端拿到新版精品课件而非回落块渲染。
    const courseId = (
      await prisma.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } })
    )?.courseId;
    if (courseId) {
      after(async () => {
        await renderCourseHtmlBestEffort(courseId);
      });
    }

    return ok({ lessonId, blocks: result.blocks });
  });
}
