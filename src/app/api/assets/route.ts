import { NextRequest } from "next/server";
import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { creatorAssetDiskPath, MAX_CREATOR_ASSET_BYTES, storeCreatorAsset, validateCreatorAsset } from "@/lib/creator-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets：只列当前创作者自己的素材，支持 kind 与文件名检索。 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const kind = req.nextUrl.searchParams.get("kind")?.trim();
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 80);
    const assets = await prisma.asset.findMany({
      where: {
        userId: user.id,
        ...(kind && ["image", "video", "pdf", "presentation"].includes(kind) ? { kind } : {}),
        ...(q ? { fileName: { contains: q } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
    });
    return ok({ assets: assets.map((asset) => ({ ...asset, url: `/api/assets/${asset.id}` })) });
  });
}

/** POST /api/assets：图片/视频/PDF/PPT 上传到私有素材库，内容魔数校验，最大 100MB。 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "creator_asset_upload", 60, 3_600_000);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("请选择素材文件");
    if (file.size <= 0 || file.size > MAX_CREATOR_ASSET_BYTES) return fail("素材大小必须在 1B 到 100MB 之间");
    const bytes = Buffer.from(await file.arrayBuffer());
    const checked = validateCreatorAsset(file.type, bytes);
    if (!checked) return fail("仅支持内容真实的 PNG/JPG/WebP/GIF、MP4/WebM、PDF 或 PPTX");
    const stored = await storeCreatorAsset(bytes, checked.ext);
    try {
      const asset = await prisma.asset.create({
        data: {
          userId: user.id,
          kind: checked.kind,
          fileName: file.name.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 255) || `asset.${checked.ext}`,
          mimeType: file.type,
          size: bytes.length,
          storagePath: stored.storagePath,
          sha256: stored.sha256,
        },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      });
      return ok({ asset: { ...asset, url: `/api/assets/${asset.id}` } });
    } catch (error) {
      const diskPath = creatorAssetDiskPath(stored.storagePath);
      if (diskPath) await unlink(diskPath).catch(() => {});
      throw error;
    }
  });
}
