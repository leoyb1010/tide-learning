import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { validateCreativeDesign, serializeCreativeDesign } from "@/lib/ai/courseware-creative-design";
import { cleanLibraryText, creatorLibrarySlug } from "@/lib/creator-library";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const scope = req.nextUrl.searchParams.get("scope") === "market" ? "market" : "mine";
    const themes = await prisma.theme.findMany({
      where: scope === "market"
        ? { visibility: "public", status: "published" }
        : { ownerId: user.id, status: { not: "archived" } },
      orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: {
        id: true, slug: true, name: true, description: true, visibility: true, status: true,
        usageCount: true, updatedAt: true, sourceLessonId: true, tokensJson: true,
        owner: { select: { id: true, nickname: true } },
      },
    });
    return ok({
      themes: themes.map((theme) => {
        let parsed = null;
        try { parsed = validateCreativeDesign(JSON.parse(theme.tokensJson)).design; }
        catch { parsed = null; }
        return {
          ...theme,
          tokensJson: undefined,
          preview: parsed ? {
            direction: parsed.direction, background: parsed.palette.background.hex,
            surface: parsed.palette.surface.hex, ink: parsed.palette.ink.hex, accent: parsed.palette.accent.hex,
            font: parsed.font, motif: parsed.motif,
          } : null,
        };
      }),
      scope,
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "creator_theme_save", 60, 3_600_000);
    const body = (await req.json().catch(() => null)) as {
      sourceLessonId?: string; sourceThemeId?: string; tokens?: unknown;
      name?: string; description?: string; visibility?: string;
    } | null;
    const name = cleanLibraryText(body?.name, 80);
    const description = cleanLibraryText(body?.description, 400) || null;
    const visibility = body?.visibility === "public" ? "public" : "private";
    if (!name) return fail("请填写皮肤名称");

    let sourceLessonId: string | null = null;
    let rawTokens: unknown = body?.tokens;
    const lessonId = cleanLibraryText(body?.sourceLessonId, 80);
    const sourceThemeId = cleanLibraryText(body?.sourceThemeId, 80);
    if (lessonId) {
      const lesson = await prisma.lesson.findUnique({
        where: { id: lessonId },
        select: { id: true, designJson: true, course: { select: { authorUserId: true } } },
      });
      if (!lesson) return fail("课节不存在", 404);
      if (lesson.course.authorUserId !== user.id) throw new AppError("无权保存该课节皮肤", 403);
      if (!lesson.designJson) return fail("该课节还没有可保存的原创设计");
      sourceLessonId = lesson.id;
      rawTokens = JSON.parse(lesson.designJson);
    } else if (sourceThemeId) {
      const source = await prisma.theme.findUnique({ where: { id: sourceThemeId } });
      if (!source) return fail("来源皮肤不存在", 404);
      if (source.ownerId !== user.id && !(source.visibility === "public" && source.status === "published")) {
        throw new AppError("无权克隆该皮肤", 403);
      }
      rawTokens = JSON.parse(source.tokensJson);
    }
    const checked = validateCreativeDesign(rawTokens);
    if (!checked.ok || !checked.design) return fail(`皮肤未通过安全与可读性校验：${checked.issues.join("；").slice(0, 500)}`, 422);
    const theme = await prisma.theme.create({
      data: {
        slug: creatorLibrarySlug(name), ownerId: user.id, name, description,
        tokensJson: serializeCreativeDesign(checked.design), sourceLessonId,
        visibility, status: visibility === "public" ? "published" : "draft",
      },
      select: { id: true, slug: true, name: true, visibility: true, status: true, createdAt: true },
    });
    return ok({ theme }, 201);
  });
}
