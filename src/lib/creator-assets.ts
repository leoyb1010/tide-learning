import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRIVATE_UPLOAD_DIR, matchesAttachmentMagic } from "./private-upload";

export const CREATOR_ASSET_DIR = process.env.ASSET_DIR || path.join(PRIVATE_UPLOAD_DIR, "creator-assets");
export const MAX_CREATOR_ASSET_BYTES = 100 * 1024 * 1024;

const ALLOWED: Record<string, { kind: "image" | "video" | "pdf" | "presentation"; ext: string }> = {
  "image/png": { kind: "image", ext: "png" },
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/gif": { kind: "image", ext: "gif" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/webm": { kind: "video", ext: "webm" },
  "application/pdf": { kind: "pdf", ext: "pdf" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "presentation", ext: "pptx" },
};

function matchesVideo(mime: string, bytes: Buffer): boolean {
  if (mime === "video/mp4") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mime === "video/webm") return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

function matchesPptx(bytes: Buffer): boolean {
  if (bytes.subarray(0, 4).toString("latin1") !== "PK\x03\x04") return false;
  const names = bytes.toString("latin1");
  return names.includes("[Content_Types].xml") && names.includes("ppt/");
}

export function validateCreatorAsset(mimeType: string, bytes: Buffer): { kind: string; ext: string } | null {
  const allowed = ALLOWED[mimeType];
  if (!allowed || bytes.length === 0 || bytes.length > MAX_CREATOR_ASSET_BYTES) return null;
  // 图片最终会在课件响应中安全内联；限制 10MB 防单节 HTML 被超大图片撑爆。
  if (allowed.kind === "image" && bytes.length > 10 * 1024 * 1024) return null;
  const valid = allowed.kind === "video"
    ? matchesVideo(mimeType, bytes)
    : allowed.kind === "presentation"
      ? matchesPptx(bytes)
      : matchesAttachmentMagic(mimeType, bytes);
  return valid ? allowed : null;
}

export async function storeCreatorAsset(bytes: Buffer, ext: string): Promise<{ storagePath: string; sha256: string }> {
  await mkdir(CREATOR_ASSET_DIR, { recursive: true, mode: 0o700 });
  const storagePath = `${randomUUID()}.${ext}`;
  await writeFile(path.join(CREATOR_ASSET_DIR, storagePath), bytes, { flag: "wx", mode: 0o600 });
  return { storagePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function creatorAssetDiskPath(storagePath: string): string | null {
  const name = path.basename(storagePath);
  // ".."/"." 会通过 basename 等值检查却指向目录本身/父目录(审查 L1):虽然 storagePath 只由服务端
  // UUID 生成、实际不可利用,但函数契约是"只落在素材目录内的文件",显式挡掉。
  if (!name || name === ".." || name === ".") return null;
  return name === storagePath ? path.join(CREATOR_ASSET_DIR, name) : null;
}

export async function deleteCreatorAssetFile(storagePath: string): Promise<void> {
  const diskPath = creatorAssetDiskPath(storagePath);
  if (diskPath) await unlink(diskPath).catch(() => {});
}
