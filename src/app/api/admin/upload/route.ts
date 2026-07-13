import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { storePrivateMedia } from "@/lib/private-media";

// 存储模式：mock（仅非生产演示）/ local（私有目录 + 鉴权流式输出）。
const STORAGE_MODE = process.env.STORAGE_MODE ?? "mock";

// POST /api/admin/upload — 素材上传（视频/图片等）
// mock 模式下不真正存文件，仅生成占位 assetId 供建章节时作为 videoAssetId 传回。
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req); // A2：写操作 CSRF 防护

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return fail("请选择要上传的文件");

    if (STORAGE_MODE === "mock" && process.env.NODE_ENV !== "production") {
      // mock：生成占位 assetId，不落盘（避免把大文件写进 public/uploads/ 污染仓库）。
      const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await audit({
        operatorId: admin.id,
        action: "asset.upload",
        targetType: "asset",
        targetId: assetId,
        detail: `${file.name}(${file.size}B, mock)`,
      });
      return ok({ assetId, url: `/mock-assets/${assetId}`, mode: "mock" });
    }

    if (STORAGE_MODE !== "local") return fail("未配置可用的私有存储，请设置 STORAGE_MODE=local", 503);
    try {
      const metadata = await storePrivateMedia(file);
      await audit({
        operatorId: admin.id,
        action: "asset.upload",
        targetType: "asset",
        targetId: metadata.assetId,
        detail: JSON.stringify({ fileName: metadata.fileName, size: metadata.size, mimeType: metadata.mimeType, sha256: metadata.sha256 }),
      });
      return ok({ assetId: metadata.assetId, url: `/api/stream/${metadata.assetId}`, mode: "local", metadata });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "视频上传失败", 400);
    }
  });
}
