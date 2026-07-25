import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/lessons/:id/revisions —— L4 可控造课：列出本节的历史版本（后悔药）。
 *
 * LessonRevision 每次生成/重造/重渲会存档，保留最近 3 版。此接口给「版本时光机」面板取列表。
 * 只返回可回滚判据（hasBlocks=blocksJson 非空才可回滚；rerender 版仅 htmlJson 不可回滚）与元信息。
 * 越权铁律：requireUser + 目标节所属课 authorUserId===user.id。只读，不改状态。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: { id: true, course: { select: { authorUserId: true } } },
    });
    if (!lesson || !lesson.course) return fail("章节不存在", 404);
    if (lesson.course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    // 性能(2026-07-21 实测修复):此前 select 了 blocksJson+htmlJson(单节 3 版实测 66.5KB),
    // 却只用来算 hasBlocks/hasHtml 两个布尔;且无 take。改用 SQL 侧 IS NOT NULL,实测 →0.37KB(180×)。
    // SQLite 的布尔以 0/1 返回(Prisma raw 下为 number/bigint),用 Boolean() 强转。
    const rows = await prisma.$queryRaw<
      Array<{ id: string; reason: string | null; createdAt: Date | string; hasBlocks: number | bigint; hasHtml: number | bigint }>
    >`SELECT id, reason, createdAt,
             blocksJson IS NOT NULL AS hasBlocks,
             htmlJson   IS NOT NULL AS hasHtml
        FROM LessonRevision
       WHERE lessonId = ${id}
       ORDER BY createdAt DESC
       LIMIT 20`;
    return ok({
      revisions: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        createdAt: new Date(r.createdAt).toISOString(),
        hasBlocks: Boolean(Number(r.hasBlocks)),
        hasHtml: Boolean(Number(r.hasHtml)),
      })),
    });
  });
}
