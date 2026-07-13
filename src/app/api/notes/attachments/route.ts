import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { buildExcerpt } from "@/lib/format";
import { PRIVATE_UPLOAD_DIR, attachmentDownloadPath } from "@/lib/private-upload";

export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // ≤10MB
const TEXT_PREVIEW_LEN = 2000; // 文本类抽取前 2k 字

// 允许的 MIME → 扩展名。图片入口 + 附件入口（pdf/docx/txt）共用本路由。
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/markdown": "md",
};

function safeExt(mime: string, fileName: string): string {
  if (ALLOWED[mime]) return ALLOWED[mime];
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/**
 * 头部魔数校验：不只信客户端 MIME（参考 import-pdf 的 %PDF- 检查）。
 * 图片与 PDF 有稳定魔数逐一比对；docx/doc/txt/md 无稳定魔数，维持原有大小/类型限制。
 */
function matchesMagic(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case "image/png":
      return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp":
      return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/gif":
      return bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "GIF8";
    case "application/pdf":
      return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return true;
  }
}

/**
 * POST /api/notes/attachments — 图片 / 附件入口。
 * 接受两种载荷：
 *   1) multipart/form-data：字段 file（必填）、noteId?（挂到已有笔记）、kind?（image|file）
 *   2) application/json：{ fileName, mimeType, dataBase64, noteId?, kind? }（base64 内联）
 * 存储：落到非 public 私有目录，读取必须经过本人鉴权下载路由。
 * 若未提供 noteId 则新建一条 kind="capture" 笔记挂该附件（图片可预览）。
 * 文本类（txt/md）抽取前 2k 字写入 NoteAttachment.summary。≤10MB。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, "note_attachment", 30, 60_000);

    let fileName = "";
    let mimeType = "";
    let bytes: Buffer;
    let noteIdInput: string | undefined;

    const ctype = req.headers.get("content-type") ?? "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return fail("缺少上传文件");
      noteIdInput = (form.get("noteId") as string | null)?.trim() || undefined;
      fileName = file.name || "attachment";
      mimeType = file.type || "application/octet-stream";
      const ab = await file.arrayBuffer();
      bytes = Buffer.from(ab);
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        fileName?: string;
        mimeType?: string;
        dataBase64?: string;
        noteId?: string;
      };
      if (!body.dataBase64) return fail("缺少上传文件");
      fileName = body.fileName?.trim() || "attachment";
      mimeType = body.mimeType?.trim() || "application/octet-stream";
      noteIdInput = body.noteId?.trim() || undefined;
      // 去掉可能的 data-url 前缀
      const b64 = body.dataBase64.replace(/^data:[^;]+;base64,/, "");
      try {
        bytes = Buffer.from(b64, "base64");
      } catch {
        return fail("文件编码不合法");
      }
    }

    if (bytes.length === 0) return fail("文件内容为空");
    if (bytes.length > MAX_SIZE) return fail("文件不能超过 10MB");
    if (!ALLOWED[mimeType]) return fail("不支持的文件类型");
    if (!matchesMagic(mimeType, bytes)) return fail("文件内容与声明类型不符");

    const isImage = mimeType.startsWith("image/");

    // 若指定 noteId：校验归属（越权铁律 where userId）
    let noteId = noteIdInput ?? null;
    let createdNoteId: string | null = null;
    if (noteId) {
      const owned = await prisma.note.findFirst({
        where: { id: noteId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!owned) return fail("笔记不存在", 404);
    }

    // 文本类：抽取前 2k 字作为 summary（用于列表/AI 后续消化）
    let summary: string | null = null;
    if (mimeType === "text/plain" || mimeType === "text/markdown") {
      summary = bytes.toString("utf-8").slice(0, TEXT_PREVIEW_LEN).trim() || null;
    }

    // 落盘到非 public 目录；随机存储名不作为可直接访问 URL。
    const ext = safeExt(mimeType, fileName);
    const storedName = `${randomUUID()}.${ext}`;
    const attachmentId = randomUUID();
    const diskPath = path.join(PRIVATE_UPLOAD_DIR, storedName);
    const downloadPath = attachmentDownloadPath(attachmentId);
    await mkdir(PRIVATE_UPLOAD_DIR, { recursive: true });
    await writeFile(diskPath, bytes);

    // 事务：（可选）新建挂载笔记 → 建附件。新建笔记时做免费额度校验。
    // 事务失败（如 402 配额超限）时清理已落盘文件，不留孤儿。
    let result: { attachment: { id: string; fileName: string; mimeType: string; size: number; path: string; summary: string | null } };
    try {
      result = await prisma.$transaction(async (tx) => {
        if (!noteId) {
          const snapshot = await resolveEntitlement(user.id);
          if (!snapshot.canCreateNoteUnlimited) {
            const count = await tx.note.count({ where: { userId: user.id, deletedAt: null } });
            if (count >= snapshot.noteFreeLimit) {
              throw new AppError(`免费用户最多创建 ${snapshot.noteFreeLimit} 篇笔记，订阅后可无限记录`, 402);
            }
          }
          const title = fileName.slice(0, 200);
          // 图片 → kind=capture 并把图挂到 captureUrl 便于详情页预览；其他文件 → text
          const contentMd = summary
            ? `> 附件：${fileName}\n\n${summary}`
            : `> 附件：${fileName}`;
          const note = await tx.note.create({
            data: {
              userId: user.id,
              title,
              contentMd,
              excerpt: buildExcerpt(contentMd),
              source: "attachment",
              kind: isImage ? "capture" : "text",
              captureUrl: isImage ? downloadPath : null,
            },
            select: { id: true },
          });
          noteId = note.id;
          createdNoteId = note.id;
        }

        const attachment = await tx.noteAttachment.create({
          data: {
            id: attachmentId,
            noteId: noteId!,
            fileName: fileName.slice(0, 255),
            mimeType,
            size: bytes.length,
            path: storedName,
            summary,
          },
          select: { id: true, fileName: true, mimeType: true, size: true, path: true, summary: true },
        });
        return { attachment };
      });
    } catch (e) {
      await unlink(diskPath).catch(() => {});
      throw e;
    }

    await track({
      eventName: "note_attachment",
      userId: user.id,
      properties: { mime: mimeType, size: bytes.length, is_image: isImage, new_note: createdNoteId != null },
    });

    return ok({
      noteId,
      createdNote: createdNoteId != null,
      attachment: { ...result.attachment, path: downloadPath },
    });
  });
}
