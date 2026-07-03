import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

// 存储模式：mock（默认，不落盘只返回占位 assetId）/ 真实对象存储（OSS/S3）
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

    if (STORAGE_MODE === "mock") {
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

    // TODO(真实对象存储)：STORAGE_MODE !== "mock" 时接入 OSS/S3。
    // 推荐两种实现之一：
    //   1) 前端直传：本接口只签发预签名 PUT URL，前端直接 PUT 到对象存储，
    //      再把返回的 objectKey 作为 videoAssetId 提交建章节；
    //   2) 服务端中转：本接口把 file 流式写入对象存储（putObject），
    //      返回稳定的 objectKey / CDN url。
    // 无论哪种，返回结构需与 mock 保持一致：{ assetId, url, mode }。
    return fail("真实对象存储尚未接入", 501);
  });
}
