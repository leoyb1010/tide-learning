import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { creatorAssetDiskPath, deleteCreatorAssetFile } from "@/lib/creator-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return fail("需要登录", 401);
  const asset = await prisma.asset.findFirst({ where: { id: (await params).id, userId: user.id } });
  if (!asset) return fail("素材不存在", 404);
  const diskPath = creatorAssetDiskPath(asset.storagePath);
  const bytes = diskPath ? await readFile(diskPath).catch(() => null) : null;
  if (!bytes) return fail("素材文件不存在", 404);
  const inline = asset.kind === "image" || asset.kind === "video";
  const safeName = asset.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const asset = await prisma.asset.findFirst({ where: { id: (await params).id, userId: user.id }, select: { id: true, storagePath: true } });
    if (!asset) return fail("素材不存在", 404);
    await prisma.asset.delete({ where: { id: asset.id } });
    await deleteCreatorAssetFile(asset.storagePath);
    return ok({ deleted: true });
  });
}
