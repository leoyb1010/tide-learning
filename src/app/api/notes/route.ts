import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { buildExcerpt } from "@/lib/format";

export const dynamic = "force-dynamic";

// 允许的笔记类型（与 schema 保持一致）
const NOTE_KINDS = ["text", "capture", "clip"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

// 分页默认与上限（cursor 分页，避免全量返回拖垮列表）
const NOTE_PAGE_DEFAULT = 30;
const NOTE_PAGE_MAX = 50;

/**
 * GET /api/notes — 笔记馆列表
 * 支持过滤：kind（text|capture|clip）、tag（标签 id）、q（标题/正文/剪藏原文）、starred（仅收藏）、courseId
 * 分页：?cursor=<noteId>&limit=<n>（默认 30，上限 50）。以 updatedAt desc + id desc 稳定排序，
 *       多取一条判断是否有下一页，nextCursor 为下一页起点的 note id（无则 null）。
 * 返回：{ notes, groups, nextCursor, total }。notes 为当前页扁平列表，groups 按当前页归组，
 *       total 为满足过滤条件的总条数（供前端显示「共 N 条」）。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ notes: [], groups: [], nextCursor: null, total: 0 });

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    const kind = sp.get("kind");
    const tagId = sp.get("tag");
    const courseId = sp.get("courseId");
    const starred = sp.get("starred");
    const cursor = sp.get("cursor")?.trim() || null;

    // limit：非法/缺省回落默认值，钳制到上限，防止客户端拉全量
    const limitRaw = Number.parseInt(sp.get("limit") ?? "", 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, NOTE_PAGE_MAX) : NOTE_PAGE_DEFAULT;

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

    // total 与分页查询并发：total 反映满足过滤条件的全部条数（供「共 N 条」显示）
    const [total, rows] = await Promise.all([
      prisma.note.count({ where }),
      prisma.note.findMany({
        where,
        include: {
          course: { select: { title: true, slug: true } },
          lesson: { select: { title: true } },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
        // updatedAt 可能并列，追加 id 做稳定 tiebreak，保证 cursor 分页不漏不重
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        // cursor 分页：从上一页末尾 note 之后取；skip:1 跳过 cursor 自身
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        // 多取 1 条用于判断是否有下一页
        take: limit + 1,
      }),
    ]);

    // 多取的那条不进当前页，其 id 作为下一页 cursor
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? rows[limit].id : null;

    // 拍平标签结构，客户端更好用
    const flat = pageRows.map((n) => ({
      ...n,
      tags: n.tags.map((t) => t.tag),
    }));

    // 按课程归组（课程视图直接消费）。v2.2：独立笔记(courseId=null)不进课程组，仅在「全部」视图出现。
    const groupMap = new Map<
      string,
      { courseId: string; course: { title: string; slug: string }; items: typeof flat }
    >();
    for (const n of flat) {
      if (!n.courseId || !n.course) continue; // 独立笔记跳过课程归组
      const g = groupMap.get(n.courseId) ?? { courseId: n.courseId, course: n.course, items: [] };
      g.items.push(n);
      groupMap.set(n.courseId, g);
    }

    return ok({ notes: flat, groups: Array.from(groupMap.values()), nextCursor, total });
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
      source?: string; // v2.2：manual(独立笔记) / ai_transform(AI整理落库)；缺省按有无 lesson 推断
      notebookId?: string; // v2.2：归入笔记本（可空）
    };

    const kind: NoteKind =
      body.kind && (NOTE_KINDS as readonly string[]).includes(body.kind) ? (body.kind as NoteKind) : "text";

    // v2.2：courseId/lessonId 可缺省 → 独立笔记(manual)。二者要么都给(课程内记)，要么都不给(独立)。
    const isStandalone = !body.courseId && !body.lessonId;
    if (!isStandalone && (!body.courseId || !body.lessonId)) return fail("课程与章节需同时提供");

    // 文本笔记必须有正文；截帧/剪藏可只带图或原文
    const hasContent = !!body.contentMd?.trim();
    if (kind === "text" && !hasContent) return fail("笔记内容不能为空");
    if (kind === "capture" && !body.captureUrl && !hasContent) return fail("截帧笔记缺少内容");
    if (kind === "clip" && !body.sourceText?.trim() && !hasContent) return fail("剪藏笔记缺少原文");

    const snapshot = await resolveEntitlement(user.id);

    // 课程内笔记：校验章节存在 + 用户有权访问（付费章节需订阅覆盖赛道）。独立笔记跳过。
    let courseId: string | null = null;
    let lessonId: string | null = null;
    if (!isStandalone) {
      const lesson = await prisma.lesson.findUnique({
        where: { id: body.lessonId },
        select: { id: true, courseId: true, isFree: true, course: { select: { category: true } } },
      });
      if (!lesson || lesson.courseId !== body.courseId) return fail("章节不存在", 404);
      if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot)) {
        throw new AppError("该章节需订阅后才能记录笔记", 403);
      }
      courseId = body.courseId!;
      lessonId = body.lessonId!;
    }

    // 越权铁律：归入笔记本前校验该本属于当前用户
    let notebookId: string | null = null;
    if (body.notebookId) {
      const nb = await prisma.notebook.findFirst({ where: { id: body.notebookId, userId: user.id }, select: { id: true } });
      if (!nb) return fail("笔记本不存在", 404);
      notebookId = nb.id;
    }

    const source = body.source === "ai_transform" ? "ai_transform" : isStandalone ? "manual" : "lesson";
    const timestampSec = body.timestampSec ?? null;
    const title = body.title?.trim() || null;
    const sourceText = body.sourceText?.trim() || null;
    const excerpt = buildExcerpt(body.contentMd ?? sourceText ?? "");

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
          excerpt,
          source,
          notebookId,
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
      properties: { course_id: courseId, lesson_id: lessonId, kind, source, has_timestamp: timestampSec != null },
    });

    return ok(note);
  });
}
