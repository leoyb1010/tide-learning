import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 允许的笔记类型（与 schema 保持一致）
const NOTE_KINDS = ["text", "capture", "clip"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

/**
 * GET /api/notes — 笔记馆列表
 * 支持过滤：kind（text|capture|clip）、tag（标签 id）、q（标题/正文/剪藏原文）、starred（仅收藏）、courseId
 * 返回：扁平 notes + 按课程归组 groups，供三视图复用。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ notes: [], groups: [] });

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    const kind = sp.get("kind");
    const tagId = sp.get("tag");
    const courseId = sp.get("courseId");
    const starred = sp.get("starred");

    if (q) {
      // 搜索为高频操作，限流并埋点
      assertRateLimit(req, "note_search", 30, 60_000);
      await track({ eventName: "note_search", userId: user.id, properties: { q_len: q.length } });
    }

    const where: Prisma.NoteWhereInput = {
      userId: user.id,
      deletedAt: null,
      ...(courseId ? { courseId } : {}),
      ...(kind && (NOTE_KINDS as readonly string[]).includes(kind) ? { kind } : {}),
      ...(starred === "1" || starred === "true" ? { starred: true } : {}),
      ...(tagId ? { tags: { some: { tagId } } } : {}),
      ...(q
        ? { OR: [{ title: { contains: q } }, { contentMd: { contains: q } }, { sourceText: { contains: q } }] }
        : {}),
    };

    const notes = await prisma.note.findMany({
      where,
      include: {
        course: { select: { title: true, slug: true } },
        lesson: { select: { title: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 拍平标签结构，客户端更好用
    const flat = notes.map((n) => ({
      ...n,
      tags: n.tags.map((t) => t.tag),
    }));

    // 按课程归组（课程视图直接消费）
    const groupMap = new Map<
      string,
      { courseId: string; course: { title: string; slug: string }; items: typeof flat }
    >();
    for (const n of flat) {
      const g = groupMap.get(n.courseId) ?? { courseId: n.courseId, course: n.course, items: [] };
      g.items.push(n);
      groupMap.set(n.courseId, g);
    }

    return ok({ notes: flat, groups: Array.from(groupMap.values()) });
  });
}

/**
 * POST /api/notes — 创建笔记
 * 支持 kind=text|capture|clip、captureUrl（截帧）、sourceText（剪藏原文）、timestampSec（回跳）。
 * §7.2：免费配额用 $transaction 原子化校验，修复并发下越额竞态。
 * 校验 canAccessLesson：无权学习的付费章节不允许挂笔记。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, "note_create", 60, 60_000);

    const body = (await req.json()) as {
      courseId?: string;
      lessonId?: string;
      timestampSec?: number | null;
      title?: string;
      contentMd?: string;
      kind?: string;
      captureUrl?: string;
      sourceText?: string;
    };

    const kind: NoteKind =
      body.kind && (NOTE_KINDS as readonly string[]).includes(body.kind) ? (body.kind as NoteKind) : "text";

    if (!body.courseId || !body.lessonId) return fail("缺少课程或章节");
    // 文本笔记必须有正文；截帧/剪藏可只带图或原文
    const hasContent = !!body.contentMd?.trim();
    if (kind === "text" && !hasContent) return fail("笔记内容不能为空");
    if (kind === "capture" && !body.captureUrl && !hasContent) return fail("截帧笔记缺少内容");
    if (kind === "clip" && !body.sourceText?.trim() && !hasContent) return fail("剪藏笔记缺少原文");

    // 校验章节存在且用户有权访问（付费章节需订阅覆盖赛道）
    const lesson = await prisma.lesson.findUnique({
      where: { id: body.lessonId },
      select: { id: true, courseId: true, isFree: true, course: { select: { category: true } } },
    });
    if (!lesson || lesson.courseId !== body.courseId) return fail("章节不存在", 404);

    const snapshot = await resolveEntitlement(user.id);
    if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot)) {
      throw new AppError("该章节需订阅后才能记录笔记", 403);
    }

    const courseId = body.courseId;
    const lessonId = body.lessonId;
    const timestampSec = body.timestampSec ?? null;
    const title = body.title?.trim() || null;
    const sourceText = body.sourceText?.trim() || null;

    // §7.2：配额校验 + 创建放同一事务，避免并发下越过免费上限
    const note = await prisma.$transaction(async (tx) => {
      if (!snapshot.canCreateNoteUnlimited) {
        const count = await tx.note.count({ where: { userId: user.id, deletedAt: null } });
        if (count >= snapshot.noteFreeLimit) {
          throw new AppError(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
        }
      }
      return tx.note.create({
        data: {
          userId: user.id,
          courseId,
          lessonId,
          timestampSec,
          title,
          contentMd: body.contentMd ?? "",
          kind,
          captureUrl: kind === "capture" ? body.captureUrl ?? null : null,
          sourceText,
        },
      });
    });

    // 埋点：按 kind 分流 note_capture / note_clip / note_create
    const eventName = kind === "capture" ? "note_capture" : kind === "clip" ? "note_clip" : "note_create";
    await track({
      eventName,
      userId: user.id,
      properties: { course_id: courseId, lesson_id: lessonId, kind, has_timestamp: timestampSec != null },
    });

    return ok(note);
  });
}
