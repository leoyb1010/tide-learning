import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { validateCreativeDesign, serializeCreativeDesign } from "@/lib/ai/courseware-creative-design";
import { cleanLibraryText } from "@/lib/creator-library";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const existing = await prisma.theme.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return fail("皮肤不存在", 404);
    if (existing.ownerId !== user.id) throw new AppError("无权修改该皮肤", 403);
    const body = (await req.json().catch(() => null)) as {
      name?: string; description?: string; visibility?: string; tokens?: unknown;
    } | null;
    const name = body?.name === undefined ? undefined : cleanLibraryText(body.name, 80);
    if (name !== undefined && !name) return fail("皮肤名称不能为空");
    const visibility = body?.visibility === undefined ? undefined : body.visibility === "public" ? "public" : "private";
    let tokensJson: string | undefined;
    if (body?.tokens !== undefined) {
      const checked = validateCreativeDesign(body.tokens);
      if (!checked.ok || !checked.design) return fail(`皮肤未通过校验：${checked.issues.join("；").slice(0, 500)}`, 422);
      tokensJson = serializeCreativeDesign(checked.design);
    }
    const theme = await prisma.theme.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(body?.description !== undefined ? { description: cleanLibraryText(body.description, 400) || null } : {}),
        ...(tokensJson ? { tokensJson } : {}),
        ...(visibility !== undefined ? { visibility, status: visibility === "public" ? "published" : "draft" } : {}),
      },
      select: { id: true, name: true, description: true, visibility: true, status: true, updatedAt: true },
    });
    return ok({ theme });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const existing = await prisma.theme.findUnique({ where: { id }, select: { ownerId: true } });
    if (!existing) return fail("皮肤不存在", 404);
    if (existing.ownerId !== user.id) throw new AppError("无权删除该皮肤", 403);
    await prisma.$transaction([
      prisma.course.updateMany({ where: { customThemeId: id }, data: { customThemeId: null } }),
      prisma.theme.delete({ where: { id } }),
    ]);
    return ok({ deleted: true });
  });
}
