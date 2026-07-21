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
import { renderAndStoreLessonHtml, createCoursewareBudget } from "@/lib/ai/courseware-gen";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "creator_theme_apply", 30, 3_600_000);
    // 资损闸门(2026-07-21 审查 CRITICAL 修复):本路由对整课逐节 enhance:true(强模型精修),
    // 此前四要件缺三——无订阅门、无余额预检、无预算上限。零余额用户可脚本化把平台 LLM 成本刷穿
    // (recordLlmSpend 允许欠账,欠账只靠下一次 assertCanSpend 拦,而这里从不预检)。
    // 对齐 generate-lesson-html 的铁律:canUseLLM 门 + assertCanSpend 按最贵场景预检 + 逐节预算上限。
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 精修排版需订阅后使用", 402);
    await assertCanSpend(user.id, "generate_lesson_html");
    const { id } = await params;
    const theme = await prisma.theme.findUnique({ where: { id } });
    if (!theme) return fail("皮肤不存在", 404);
    if (theme.ownerId !== user.id && !(theme.visibility === "public" && theme.status === "published")) {
      throw new AppError("无权使用该皮肤", 403);
    }
    const creative = parseCreativeDesign(theme.tokensJson);
    if (!creative) return fail("皮肤未通过当前安全与可读性校验", 422);
    const body = (await req.json().catch(() => null)) as { courseId?: string; lessonId?: string } | null;
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少 courseId");
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, category: true, template: true, designJson: true, authorUserId: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权修改该课程", 403);
    const lessons = await prisma.lesson.findMany({
      where: { courseId, ...(body?.lessonId ? { id: body.lessonId } : {}), blocksJson: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, title: true, summary: true, sortOrder: true, blocksJson: true, htmlJson: true,
        renderSourceHash: true, renderEngine: true, designJson: true,
      },
    });
    if (body?.lessonId && lessons.length === 0) return fail("目标课节不存在或不属于该课程", 404);
    await prisma.$transaction([
      prisma.course.update({ where: { id: courseId }, data: { customThemeId: theme.id, lastUpdatedAt: new Date() } }),
      prisma.lesson.updateMany({ where: { id: { in: lessons.map((lesson) => lesson.id) } }, data: { designJson: theme.tokensJson } }),
      prisma.theme.update({ where: { id: theme.id }, data: { usageCount: { increment: 1 } } }),
    ]);
    const courseDesign = resolveCourseDesign(course);
    const mode = resolveCoursewareMode({ title: course.title, template: course.template });
    let rendered = 0;
    let fallback = 0;
    // 预算上限:与 renderCourseHtmlBestEffort 同款熔断,单次应用最多精修 budget 节,超出部分确定性兜底
    // (皮肤 token 仍生效,只是不走 LLM 重排),防一次调用烧穿整课上限。
    const budget = createCoursewareBudget();
    for (const lesson of lessons) {
      const result = await renderAndStoreLessonHtml(
        courseId,
        { ...lesson, designJson: theme.tokensJson },
        courseDesign,
        mode,
        { enhance: true, userId: user.id, courseTitle: course.title, category: course.category, budget },
      );
      if (result.engine === "llm") rendered += 1;
      else if (result.engine === "deterministic") fallback += 1;
    }
    return ok({ themeId: theme.id, affected: lessons.length, rendered, fallback });
  });
}
