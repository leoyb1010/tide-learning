import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";

// GET /api/notes?q=&courseId=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ notes: [] });
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q");
    const courseId = sp.get("courseId");
    const notes = await prisma.note.findMany({
      where: {
        userId: user.id,
        deletedAt: null,
        ...(courseId ? { courseId } : {}),
        ...(q ? { OR: [{ title: { contains: q } }, { contentMd: { contains: q } }] } : {}),
      },
      include: { course: { select: { title: true, slug: true } }, lesson: { select: { title: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return ok({ notes });
  });
}

// POST /api/notes — 创建笔记（自动绑定课程/章节/时间戳）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      courseId: string;
      lessonId: string;
      timestampSec?: number | null;
      title?: string;
      contentMd: string;
      sourceText?: string;
    };
    if (!body.contentMd?.trim()) return fail("笔记内容不能为空");

    // §7.2：免费用户最多 3 篇；订阅用户无限
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canCreateNoteUnlimited) {
      const count = await prisma.note.count({ where: { userId: user.id, deletedAt: null } });
      if (count >= snapshot.noteFreeLimit) {
        return fail(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
      }
    }

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        courseId: body.courseId,
        lessonId: body.lessonId,
        timestampSec: body.timestampSec ?? null,
        title: body.title ?? null,
        contentMd: body.contentMd,
        sourceText: body.sourceText ?? null,
      },
    });
    await track({
      eventName: "note_create",
      userId: user.id,
      properties: { course_id: body.courseId, lesson_id: body.lessonId, has_timestamp: body.timestampSec != null },
    });
    return ok(note);
  });
}
