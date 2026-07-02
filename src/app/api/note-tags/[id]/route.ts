import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

// DELETE /api/note-tags/:id — 删除标签（级联删除中间表关系；仅本人，越权 404）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const tag = await prisma.noteTag.findFirst({ where: { id, userId: user.id } });
    if (!tag) return fail("标签不存在", 404);
    // NoteTagOnNote 上有 onDelete: Cascade，删标签自动解绑
    await prisma.noteTag.delete({ where: { id } });
    return ok({ deleted: true });
  });
}
