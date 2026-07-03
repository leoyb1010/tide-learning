import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts/:id/like — 点赞（幂等）。
 * 用 PostLike 的 @@unique([postId, userId]) 保证一人一赞；已赞再点则取消（toggle）。
 * likeCount 与 PostLike 在同一事务内增减，避免计数漂移。
 * 越权铁律：点赞记录强制 userId=当前用户。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    const { id } = await params;

    // 轻量限流：防刷点赞
    assertUserRateLimit(user.id, "post_like", 60, 60_000);

    // 仅允许对已通过的帖子点赞
    const post = await prisma.post.findFirst({ where: { id, status: "approved" }, select: { id: true } });
    if (!post) return fail("帖子不存在或未通过审核", 404);

    // 事务内 toggle：存在则取消 + count-1，不存在则新增 + count+1（幂等）
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.postLike.findUnique({
        where: { postId_userId: { postId: id, userId: user.id } },
        select: { id: true },
      });
      if (existing) {
        await tx.postLike.delete({ where: { id: existing.id } });
        const updated = await tx.post.update({
          where: { id },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
        return { liked: false, likeCount: Math.max(0, updated.likeCount) };
      }
      await tx.postLike.create({ data: { postId: id, userId: user.id } });
      const updated = await tx.post.update({
        where: { id },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      return { liked: true, likeCount: updated.likeCount };
    });

    await track({ eventName: "post_like", userId: user.id, properties: { post_id: id, liked: result.liked } });
    return ok(result);
  });
}
