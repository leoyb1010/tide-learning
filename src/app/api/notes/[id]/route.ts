import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";

// GET /api/notes/:id — 停订后仍可查看自己的笔记（§6.5 验收）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const note = await prisma.note.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!note) return fail("笔记不存在", 404);
    return ok(note);
  });
}

// PATCH /api/notes/:id — 自动保存
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { title?: string; contentMd?: string };
    const note = await prisma.note.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!note) return fail("笔记不存在", 404);
    const updated = await prisma.note.update({
      where: { id },
      data: { title: body.title ?? note.title, contentMd: body.contentMd ?? note.contentMd },
    });
    return ok(updated);
  });
}

// DELETE /api/notes/:id — 软删除
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const note = await prisma.note.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!note) return fail("笔记不存在", 404);
    await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    return ok({ deleted: true });
  });
}
