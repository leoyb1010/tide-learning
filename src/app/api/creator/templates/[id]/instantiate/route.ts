import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { cleanLibraryText, creatorLibrarySlug, parseTemplateSnapshot, templateSkeletonBlocks } from "@/lib/creator-library";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "creator_template_instantiate", 40, 3_600_000);
    const { id } = await params;
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) return fail("模板不存在", 404);
    if (template.ownerId !== user.id && !(template.visibility === "public" && template.status === "published")) {
      throw new AppError("无权使用该模板", 403);
    }
    const snapshot = parseTemplateSnapshot(template.structureJson);
    if (!snapshot) return fail("模板结构已损坏，无法创建课程", 422);
    const body = (await req.json().catch(() => null)) as { title?: string } | null;
    const title = cleanLibraryText(body?.title, 120) || `${snapshot.course.title} · 副本`;
    const course = await prisma.$transaction(async (tx) => {
      const created = await tx.course.create({
        data: {
          slug: creatorLibrarySlug(title), title, description: snapshot.course.description,
          category: snapshot.course.category, level: snapshot.course.level,
          status: "draft", origin: "user_created", authorUserId: user.id, visibility: "private",
          sharedStatus: "private", genStatus: "ready", blueprintJson: snapshot.course.blueprintJson,
          contentBriefJson: snapshot.course.contentBriefJson, customTemplateId: template.id,
          lessons: {
            create: snapshot.lessons.map((lesson, index) => ({
              title: lesson.title, summary: lesson.summary, sortOrder: index, contentType: "ai_block",
              blocksJson: JSON.stringify({ version: 1, blocks: templateSkeletonBlocks(lesson.blockTypes, lesson.title) }), durationSec: 0,
              isFree: index === 0, status: "published", publishedAt: new Date(),
            })),
          },
        },
        select: { id: true, slug: true, title: true },
      });
      await tx.template.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } });
      return created;
    });
    return ok({ course }, 201);
  });
}
