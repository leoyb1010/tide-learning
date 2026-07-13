import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { attachmentDiskPath } from "@/lib/private-upload";
import { fail, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const attachment = await prisma.noteAttachment.findFirst({
      where: { id, note: { userId: user.id, deletedAt: null } },
      select: { path: true, mimeType: true, fileName: true },
    });
    if (!attachment) return fail("附件不存在", 404);
    const diskPath = attachmentDiskPath(attachment.path);
    if (!diskPath) return fail("附件路径无效", 404);
    const bytes = await readFile(diskPath).catch(() => null);
    if (!bytes) return fail("附件文件不存在", 404);
    const asciiName = attachment.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(bytes.length),
        "content-disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
