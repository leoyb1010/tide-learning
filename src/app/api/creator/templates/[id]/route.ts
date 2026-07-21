import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { cleanLibraryText } from "@/lib/creator-library";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const existing = await prisma.template.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return fail("模板不存在", 404);
    if (existing.ownerId !== user.id) throw new AppError("无权修改该模板", 403);
    const body = (await req.json().catch(() => null)) as { name?: string; description?: string; visibility?: string } | null;
    const name = body?.name === undefined ? undefined : cleanLibraryText(body.name, 80);
    if (name !== undefined && !name) return fail("模板名称不能为空");
    const visibility = body?.visibility === undefined ? undefined : body.visibility === "public" ? "public" : "private";
    const template = await prisma.template.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(body?.description !== undefined ? { description: cleanLibraryText(body.description, 400) || null } : {}),
        ...(visibility !== undefined ? { visibility, status: visibility === "public" ? "published" : "draft" } : {}),
      },
      select: { id: true, name: true, description: true, visibility: true, status: true, updatedAt: true },
    });
    return ok({ template });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const existing = await prisma.template.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return fail("模板不存在", 404);
    if (existing.ownerId !== user.id) throw new AppError("无权删除该模板", 403);
    await prisma.template.delete({ where: { id } });
    return ok({ deleted: true });
  });
}
