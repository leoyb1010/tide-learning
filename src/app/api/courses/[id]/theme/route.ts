import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { resolveCourseDesign, serializeCourseDesign, getArtDirection } from "@/lib/ai/courseware-design";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";
import { CoursePresentationMutationLostError, renderAndStoreLessonHtml } from "@/lib/ai/courseware-gen";
import { beginCoursePresentationMutation, settleExternalCoursePresentation } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/theme —— L5 可控造课：换课件皮肤（艺术方向）+ 确定性重排（免费，零 LLM）。
 *
 * body: { artKey }。把 designJson 的 artKey 换成用户选定方向（保留 variance/motion/density 旋钮，
 * 避免丢旋钮后 resolveCourseDesign 重新按赛道派生、悄悄改变每节观感），然后对每节走确定性重渲
 * （enhance=false 不调 LLM、不花钱；force=true 让重选同一皮肤也真重排）。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId===user.id。整课重渲较重，加每小时 30 次粗限流。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();
    assertUserRateLimit(user.id, "course_theme_switch", 30, 3_600_000);

    const body = (await req.json().catch(() => null)) as { artKey?: string } | null;
    const artKey = body?.artKey?.trim();
    if (!artKey) return fail("缺少 artKey");
    // 白名单校验：getArtDirection 对未知 key 会回落第一个，故用「回落后 key 是否等于入参」判定合法。
    if (getArtDirection(artKey).key !== artKey) return fail("未知的课件皮肤", 400);

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, title: true, category: true, template: true, designJson: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    // 保留旋钮、只换艺术方向，序列化回 designJson。
    // v5：用户手动选固定皮肤 = 明确覆盖合成皮肤,必须清掉 brief（否则 serializeCourseDesign 仍按 brief 存,
    // 换肤被忽略）。清 brief 后序列化落传统 artKey 格式,用户选择生效。
    const cur = resolveCourseDesign(course);
    const nextDesign = { ...cur, art: getArtDirection(artKey), brief: undefined };
    const mutation = await beginCoursePresentationMutation(course.id);
    if (!mutation.ok) {
      if (mutation.reason === "faithful_import") return fail("忠实导入课件不能用普通换肤覆盖", 409);
      if (mutation.reason === "archived") return fail("已归档课程不能换肤", 409);
      if (mutation.reason === "active_generation") return fail("课程正在生成或暂停中，请先等待任务收敛", 409);
      return fail("课程暂无可重排的课节", mutation.reason === "not_found" ? 404 : 400);
    }
    const designStored = await prisma.course.updateMany({
      where: { id: course.id, presentationRevision: mutation.revision, genStatus: "failed" },
      data: { designJson: serializeCourseDesign(nextDesign) },
    });
    if (designStored.count !== 1) return fail("已有新的换肤操作，本次结果已丢弃", 409);

    // 逐节确定性重渲（仅有内容块的节）。mode 随新 artKey 反推，保证风格与 art token 同源。
    const mode = resolveCoursewareMode({ title: course.title, template: course.template, artKey });
    const lessons = await prisma.lesson.findMany({
      where: { courseId: course.id, blocksJson: { not: null } },
      orderBy: { sortOrder: "asc" },
      // designJson/renderEngine 必须带上(2026-07-21 审查 M 修复):v6 起 lesson.designJson 存逐节原创
      // 设计 token,select 漏掉会让 renderAndStoreLessonHtml 落库时把它静默清空——用户换个固定皮肤,
      // 整课花钱精修出的逐节设计全没了,回 bespoke 时还得重烧 LLM。
      select: { id: true, title: true, summary: true, sortOrder: true, blocksJson: true, htmlJson: true, renderSourceHash: true, renderEngine: true, designJson: true },
    });

    let rendered = 0;
    let skipped = 0;
    for (const l of lessons) {
      try {
        const r = await renderAndStoreLessonHtml(course.id, l, nextDesign, mode, {
          enhance: false,
          userId: user.id,
          force: true,
          presentationRevision: mutation.revision,
          billingKey: `presentation:${course.id}:r${mutation.revision}:${l.id}`,
        });
        if (r.engine === "deterministic" || r.engine === "llm") rendered += 1;
        else skipped += 1; // engine:'none' —— 被并发渲染 claim 占用或无块
      } catch (error) {
        if (error instanceof CoursePresentationMutationLostError) {
          return fail("已有新的换肤操作，本次结果已丢弃", 409);
        }
        skipped += 1;
      }
    }

    const presentation = await settleExternalCoursePresentation(course.id, mutation.revision);
    if (!presentation.settled) return fail("课件表现层已发生并发变更，请重试", 409);
    if (!presentation.contentReady || presentation.status === "incomplete" || skipped > 0) {
      return fail(`换肤未完整交付（${presentation.ready}/${presentation.total}），课程已保持为不可发布状态，可免费重试`, 409);
    }
    return ok({ artKey, rendered, skipped, total: lessons.length, presentationStatus: presentation.status });
  });
}
