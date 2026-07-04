import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import NotesClient, { type NotesInitialData } from "./NotesClient";

// 类型唯一真相源：NoteTimeline / NoteGallery 仍从 "@/app/notes/page" 导入这些类型，
// 故在此从交互岛 re-export（仅类型，编译期擦除，不引入 client 运行时依赖）。
export type { NoteRow, NoteTagLite, TagFacet } from "./NotesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "笔记馆" };

// 首屏页大小（与 /api/notes 的 NOTE_PAGE_DEFAULT 对齐）
const FIRST_PAGE = 30;

/**
 * 笔记馆页面外壳（Server Component）。
 * v3.0：首屏在服务端直查（30 条笔记 + 标签 + 登录态），作为 initialData 注入交互岛，
 * 消除旧版「整页 use client 首屏 3 个 fetch 才有数据」的空窗。
 * 所有交互（视图切换/筛选/AI 整理/滚动加载更多）在 NotesClient（"use client"）里进行。
 */
export default async function NotesPage() {
  const user = await getCurrentUser();

  // 未登录：交互岛用空数据渲染登录引导，不查库。
  if (!user) {
    const empty: NotesInitialData = { notes: [], nextCursor: null, total: 0, tags: [], loggedIn: false };
    return <NotesClient initialData={empty} />;
  }

  // 首屏「全部」列表的默认过滤（无搜索/无标签/无课程）。与 API 的稳定排序保持一致：
  // updatedAt desc + id desc（cursor 分页 tiebreak），多取 1 条判断是否有下一页。
  const where: Prisma.NoteWhereInput = { userId: user.id, deletedAt: null };

  const [total, rows, tagRows] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      include: {
        course: { select: { title: true, slug: true } },
        lesson: { select: { title: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: FIRST_PAGE + 1,
    }),
    prisma.noteTag.findMany({
      where: { userId: user.id },
      include: { _count: { select: { notes: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const hasMore = rows.length > FIRST_PAGE;
  const pageRows = hasMore ? rows.slice(0, FIRST_PAGE) : rows;
  const nextCursor = hasMore ? rows[FIRST_PAGE].id : null;

  // 序列化为可传给 client 组件的普通对象（Date → ISO 字符串，拍平标签结构）。
  const notes = pageRows.map((n) => ({
    id: n.id,
    title: n.title,
    contentMd: n.contentMd,
    excerpt: n.excerpt,
    sourceText: n.sourceText,
    kind: n.kind,
    source: n.source,
    captureUrl: n.captureUrl,
    starred: n.starred,
    pinned: n.pinned,
    timestampSec: n.timestampSec,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    notebookId: n.notebookId,
    courseId: n.courseId,
    lessonId: n.lessonId,
    course: n.course ? { title: n.course.title, slug: n.course.slug } : null,
    lesson: n.lesson ? { title: n.lesson.title } : null,
    tags: n.tags.map((t) => t.tag),
  }));

  const tags = tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.notes }));

  const initialData: NotesInitialData = { notes, nextCursor, total, tags, loggedIn: true };

  return <NotesClient initialData={initialData} />;
}
