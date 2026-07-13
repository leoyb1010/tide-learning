import path from "node:path";

export const PRIVATE_UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), ".data", "uploads");

export function attachmentDownloadPath(id: string): string {
  return `/api/notes/attachments/${encodeURIComponent(id)}`;
}

export function attachmentDiskPath(storagePath: string): string | null {
  const name = path.basename(storagePath);
  if (!name || name !== storagePath.replace(/^\/uploads\//, "")) return null;
  return storagePath.startsWith("/uploads/")
    ? path.join(process.cwd(), "public", "uploads", name)
    : path.join(PRIVATE_UPLOAD_DIR, name);
}
