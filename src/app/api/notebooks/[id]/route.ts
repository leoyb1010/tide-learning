import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

const TITLE_MAX = 40;

/**
 * GET /api/notebooks/:id — 笔记本详情 + 其下笔记列表
 * 越权铁律：先校验 notebook.userId === user.id，否则 404（不泄露资源存在性）。
 * 笔记列表：note where notebookId AND userId AND deletedAt:null，按 pinned desc, updatedAt desc。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;

    const notebook = await prisma.notebook.findFirst({
      where: { id, userId: user.id },
      select: { id: true, title: true, description: true, icon: true, createdAt: true, updatedAt: true },
    });
    if (!notebook) return fail("笔记本不存在", 404);

    // 二次强制 userId：即便 notebookId 命中，也只回本人未删除的笔记
    const notes = await prisma.note.findMany({
      where: { notebookId: id, userId: user.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        excerpt: true,
        source: true,
        pinned: true,
        updatedAt: true,
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });

    return ok({ notebook, notes });
  });
}

/**
 * PATCH /api/notebooks/:id — 改 title/description/icon
 * where { id, userId }：仅本人可改，越权当 404。仅传入的字段才更新，避免误清空。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string | null;
      icon?: string | null;
    };

    if (body.title !== undefined) {
      const t = body.title?.trim();
      if (!t) return fail("笔记本标题不能为空");
      if (t.length > TITLE_MAX) return fail(`标题最多 ${TITLE_MAX} 个字`);
    }

    const owned = await prisma.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!owned) return fail("笔记本不存在", 404);

    const updated = await prisma.notebook.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title!.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
        ...(body.icon !== undefined ? { icon: body.icon?.trim() || null } : {}),
      },
      select: { id: true, title: true, description: true, icon: true, updatedAt: true },
    });

    return ok(updated);
  });
}

/**
 * DELETE /api/notebooks/:id — 删除笔记本（Notebook 无 deletedAt，硬删）
 * where { id, userId }：仅本人，越权 404。其下笔记的 notebookId 因 onDelete:SetNull 自动置空
 * （笔记本身不删，退回为独立笔记）。NotebookEntry 侧为 onDelete:Cascade。
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;

    const owned = await prisma.notebook.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!owned) return fail("笔记本不存在", 404);

    await prisma.notebook.delete({ where: { id } });
    return ok({ deleted: true });
  });
}
