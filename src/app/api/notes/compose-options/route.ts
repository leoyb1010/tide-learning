import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getMyShelf } from "@/lib/shelf";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes/compose-options —— 「记一条」弹窗智能化所需的三组选项，一次拉齐。
 *
 * 返回 { notebooks, tags, courses }：
 *  - notebooks：本人全部笔记本（供「归入哪个笔记本」下拉，默认未归类=不选）。
 *  - tags：本人全部标签（供标签多选面板，展示已有可勾选；新标签由 note-tags API 现场创建）。
 *  - courses：本人「在学/拥有」的课程（书架五类去重），供「快捷关联课程」选择器。
 *
 * 越权铁律：所有查询强制 where userId（notebook/note-tag 直查；courses 走 getMyShelf，内部同样按 userId 隔离）。
 * 游客返回三个空数组（与 /api/notebooks、/api/note-tags 一致，不抛 401，前端统一渲染）。
 * 纯读接口，供 client 侧 fetch —— client 不直接 import server 链，仅通过本接口取数据。
 */
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ notebooks: [], tags: [], courses: [] });

    const [notebookRows, tagRows, shelf] = await Promise.all([
      prisma.notebook.findMany({
        where: { userId: user.id },
        select: { id: true, title: true, icon: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.noteTag.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, color: true },
        orderBy: { createdAt: "asc" },
      }),
      getMyShelf(user.id),
    ]);

    // 书架五类去重成一份「我的课程」（在学优先，其余按出现顺序补充）。
    const courseMap = new Map<string, { id: string; slug: string; title: string }>();
    for (const bucket of [
      shelf.learning,
      shelf.ai_created,
      shelf.imported,
      shelf.collected,
      shelf.completed,
    ]) {
      for (const c of bucket) {
        if (!courseMap.has(c.id)) courseMap.set(c.id, { id: c.id, slug: c.slug, title: c.title });
      }
    }

    return ok({
      notebooks: notebookRows,
      tags: tagRows,
      courses: Array.from(courseMap.values()),
    });
  });
}
