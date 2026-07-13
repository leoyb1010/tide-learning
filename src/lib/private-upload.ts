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

/** 附件内容嗅探：客户端 MIME/扩展名不作为信任依据。 */
export function matchesAttachmentMagic(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case "image/png": return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case "image/jpeg": return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp": return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/gif": return bytes.subarray(0, 4).toString("latin1") === "GIF8";
    case "application/pdf": return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    case "application/msword": return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      if (bytes.subarray(0, 4).toString("latin1") !== "PK\x03\x04") return false;
      const names = bytes.toString("latin1");
      return names.includes("[Content_Types].xml") && names.includes("word/");
    }
    case "text/plain":
    case "text/markdown":
      if (bytes.includes(0)) return false;
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
    default: return false;
  }
}
