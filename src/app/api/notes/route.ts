import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { hasPurchasedCourse } from "@/lib/queries";
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
      tagIds?: string[]; // v3.1：创建时批量关联标签（每个标签须属本人，越权铁律）
    };

    // as-cast 不做运行时收窄：字符串字段传入非字符串（如数字）时 ?.trim() 会抛 TypeError 变 500。
    // 这里统一收窄为 400 客户端错误。
    for (const k of ["courseId", "lessonId", "title", "contentMd", "kind", "captureUrl", "sourceText", "source", "notebookId"] as const) {
      if (body[k] != null && typeof body[k] !== "string") return fail(`字段 ${k} 类型错误`);
    }
    if (body.timestampSec != null && typeof body.timestampSec !== "number") return fail("字段 timestampSec 类型错误");
    if (body.tagIds != null && (!Array.isArray(body.tagIds) || body.tagIds.some((t) => typeof t !== "string")))
      return fail("字段 tagIds 类型错误");

    const kind: NoteKind =
      body.kind && (NOTE_KINDS as readonly string[]).includes(body.kind) ? (body.kind as NoteKind) : "text";

    // 三态归属：
    //  1) 课程内记(lessonBound)：带 lessonId → 必须同时带 courseId，且校验章节存在 + 有权访问（付费章节需订阅）。
    //  2) 软关联课程(soft)：仅带 courseId（无 lessonId）→ 独立笔记「快捷关联课程」，不解锁任何章节内容，
    //     故只校验课程可浏览（published+public/unlisted），不做 entitlement 门槛。source 仍按 manual/ai_transform。
    //  3) 完全独立(standalone)：二者都不带。
    const lessonBound = !!body.lessonId;
    if (lessonBound && !body.courseId) return fail("课程与章节需同时提供");

    // 文本笔记必须有正文；截帧/剪藏可只带图或原文
    const hasContent = !!body.contentMd?.trim();
    if (kind === "text" && !hasContent) return fail("笔记内容不能为空");
    if (kind === "capture" && !body.captureUrl && !hasContent) return fail("截帧笔记缺少内容");
    if (kind === "clip" && !body.sourceText?.trim() && !hasContent) return fail("剪藏笔记缺少原文");

    const snapshot = await resolveEntitlement(user.id);

    let courseId: string | null = null;
    let lessonId: string | null = null;
    if (lessonBound) {
      // 课程内记：校验章节存在 + 用户有权访问（付费章节需订阅覆盖赛道）。
      const lesson = await prisma.lesson.findUnique({
        where: { id: body.lessonId },
        select: { id: true, courseId: true, isFree: true, course: { select: { category: true } } },
      });
      if (!lesson || lesson.courseId !== body.courseId) return fail("章节不存在", 404);
      // 买断放行：已购本课（CoursePurchase 所有权真值源）则可记笔记，不走赛道订阅门（修 P0 买断失能）。
      const owned = await hasPurchasedCourse(lesson.courseId, user.id);
      if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot, owned)) {
        throw new AppError("该章节需订阅后才能记录笔记", 403);
      }
      courseId = body.courseId!;
      lessonId = body.lessonId!;
    } else if (body.courseId) {
      // 软关联：仅确认课程存在且可浏览（不泄露草稿/私有课）。无章节即无内容解锁，故不做 entitlement 校验。
      const course = await prisma.course.findFirst({
        where: {
          id: body.courseId,
          status: "published",
          visibility: { in: ["public", "unlisted"] },
        },
        select: { id: true },
      });
      if (!course) return fail("课程不存在", 404);
      courseId = course.id;
    }

    // 是否落库为独立笔记（source 推断用）：无 lesson 绑定即独立（软关联课程仍属独立笔记）。
    const isStandalone = !lessonBound;

    // 越权铁律：归入笔记本前校验该本属于当前用户
    let notebookId: string | null = null;
    if (body.notebookId) {
      const nb = await prisma.notebook.findFirst({ where: { id: body.notebookId, userId: user.id }, select: { id: true } });
      if (!nb) return fail("笔记本不存在", 404);
      notebookId = nb.id;
    }

    // 越权铁律：创建时关联标签前，按 userId 校验每个标签归属本人。
    // 只保留「既在请求里、又属本人」的标签 id（去重），过滤越权/不存在的 id。
    let validTagIds: string[] = [];
    if (Array.isArray(body.tagIds) && body.tagIds.length > 0) {
      const requested = Array.from(
        new Set(body.tagIds.filter((t): t is string => typeof t === "string" && t.length > 0)),
      );
      if (requested.length > 0) {
        const owned = await prisma.noteTag.findMany({
          where: { id: { in: requested }, userId: user.id },
          select: { id: true },
        });
        validTagIds = owned.map((t) => t.id);
      }
    }

    const source = body.source === "ai_transform" ? "ai_transform" : isStandalone ? "manual" : "lesson";
    const timestampSec = body.timestampSec ?? null;
    const title = body.title?.trim() || null;
    const sourceText = body.sourceText?.trim() || null;
    const excerpt = buildExcerpt(body.contentMd ?? sourceText ?? "");

    // §7.2：配额校验 + 创建 + 标签关联放同一事务，避免并发下越过免费上限、且标签关联原子化随笔记落库
    const note = await prisma.$transaction(async (tx) => {
      if (!snapshot.canCreateNoteUnlimited) {
        const count = await tx.note.count({ where: { userId: user.id, deletedAt: null } });
        if (count >= snapshot.noteFreeLimit) {
          throw new AppError(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
        }
      }
      const created = await tx.note.create({
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
          // 创建时关联标签（已按 userId 校验归属）；空数组则不生成任何 join 行
          ...(validTagIds.length > 0
            ? { tags: { create: validTagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
        // 响应形状与 GET 列表项对齐（含 tags/course/lesson）：裸 create 不返回关系字段，
        // 客户端（iOS Note DTO 的非 Optional tags）解码会断
        include: {
          course: { select: { title: true, slug: true } },
          lesson: { select: { title: true } },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });
      return created;
    });

    // 埋点：按 kind 分流 note_capture / note_clip / note_create
    const eventName = kind === "capture" ? "note_capture" : kind === "clip" ? "note_clip" : "note_create";
    await track({
      eventName,
      userId: user.id,
      properties: { course_id: courseId, lesson_id: lessonId, kind, source, has_timestamp: timestampSec != null },
    });

    // 拍平标签结构，与 GET 列表一致
    return ok({ ...note, tags: note.tags.map((t) => t.tag) });
  });
}
