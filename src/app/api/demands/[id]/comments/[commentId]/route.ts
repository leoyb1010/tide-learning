import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, hasPermission } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

// DELETE /api/demands/:id/comments/:commentId — 本人或版主软删
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id, commentId } = await params;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true, demandId: true, deletedAt: true },
    });
    if (!comment || comment.demandId !== id) return fail("评论不存在", 404);
    if (comment.deletedAt) return ok({ deleted: true }); // 幂等

    const isModerator = hasPermission(user.role, "demand:moderate");
    if (comment.userId !== user.id && !isModerator) {
      return fail("无权删除该评论", 403);
    }

    // 软删：保留楼层结构，正文由读取端脱敏。
    await prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    return ok({ deleted: true });
  });
}
