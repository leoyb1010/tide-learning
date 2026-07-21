import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { validateBlocks } from "@/lib/blocks";
import { cleanLibraryText, creatorLibrarySlug, type CreatorTemplateSnapshot } from "@/lib/creator-library";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const scope = req.nextUrl.searchParams.get("scope") === "market" ? "market" : "mine";
    const templates = await prisma.template.findMany({
      where: scope === "market"
        ? { visibility: "public", status: "published" }
        : { ownerId: user.id, status: { not: "archived" } },
      orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
      take: 100,
      select: {
        id: true, slug: true, name: true, description: true, visibility: true, status: true,
        usageCount: true, updatedAt: true, sourceCourseId: true,
        owner: { select: { id: true, nickname: true } },
      },
    });
    return ok({ templates, scope });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "creator_template_save", 60, 3_600_000);
    const body = (await req.json().catch(() => null)) as {
      courseId?: string; name?: string; description?: string; visibility?: string;
    } | null;
    const courseId = cleanLibraryText(body?.courseId, 80);
    const name = cleanLibraryText(body?.name, 80);
    const description = cleanLibraryText(body?.description, 400) || null;
    const visibility = body?.visibility === "public" ? "public" : "private";
    if (!courseId || !name) return fail("请填写模板名称并选择课程");
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true, authorUserId: true, title: true, description: true, category: true, level: true,
        blueprintJson: true, contentBriefJson: true,
        lessons: { orderBy: { sortOrder: "asc" }, select: { title: true, summary: true, blocksJson: true } },
      },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权保存该课程模板", 403);
    if (course.lessons.length === 0) return fail("课程至少需要一节课才能保存模板");
    const snapshot: CreatorTemplateSnapshot = {
      v: 1,
      course: {
        title: course.title,
        description: course.description,
        category: course.category,
        level: course.level,
        blueprintJson: course.blueprintJson,
        contentBriefJson: course.contentBriefJson,
      },
      lessons: course.lessons.map((lesson) => {
        let blockTypes: string[] = [];
        try {
          const parsed = JSON.parse(lesson.blocksJson ?? "[]") as { blocks?: unknown };
          blockTypes = validateBlocks(parsed.blocks ?? parsed).map((block) => block.type);
        } catch {
          blockTypes = [];
        }
        return { title: lesson.title, summary: lesson.summary, blockTypes };
      }),
    };
    const template = await prisma.template.create({
      data: {
        slug: creatorLibrarySlug(name), ownerId: user.id, name, description,
        structureJson: JSON.stringify(snapshot), sourceCourseId: course.id,
        visibility, status: visibility === "public" ? "published" : "draft",
      },
      select: { id: true, slug: true, name: true, visibility: true, status: true, createdAt: true },
    });
    return ok({ template }, 201);
  });
}
