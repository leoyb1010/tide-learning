import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { resolveCourseDesign, serializeCourseDesign, getArtDirection, ART_DIRECTIONS } from "@/lib/ai/courseware-design";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";
import { renderAndStoreLessonHtml } from "@/lib/ai/courseware-gen";

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
    const cur = resolveCourseDesign(course);
    const nextDesign = { ...cur, art: getArtDirection(artKey) };
    await prisma.course.update({ where: { id: course.id }, data: { designJson: serializeCourseDesign(nextDesign) } });

    // 逐节确定性重渲（仅有内容块的节）。mode 随新 artKey 反推，保证风格与 art token 同源。
    const mode = resolveCoursewareMode({ title: course.title, template: course.template, artKey });
    const lessons = await prisma.lesson.findMany({
      where: { courseId: course.id, blocksJson: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, sortOrder: true, blocksJson: true, htmlJson: true, renderSourceHash: true },
    });

    let rendered = 0;
    let skipped = 0;
    for (const l of lessons) {
      try {
        const r = await renderAndStoreLessonHtml(course.id, l, nextDesign, mode, { enhance: false, userId: user.id, force: true });
        if (r.engine === "deterministic" || r.engine === "llm") rendered += 1;
        else skipped += 1; // engine:'none' —— 被并发渲染 claim 占用或无块
      } catch {
        skipped += 1;
      }
    }

    return ok({ artKey, rendered, skipped, total: lessons.length });
  });
}
