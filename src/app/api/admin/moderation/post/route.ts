import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

// POST /api/admin/moderation/post — 审核社区帖子（内容审核台）。
// body: { postId, action: "approve" | "reject", reason? }
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const admin = await requirePermission("content:review");

    const body = (await req.json()) as {
      postId?: string;
      action?: "approve" | "reject";
      reason?: string;
    };
    const postId = body.postId?.trim();
    if (!postId) return fail("缺少 postId");
    if (body.action !== "approve" && body.action !== "reject") return fail("非法操作类型");

    const reason = body.reason?.trim();
    if (body.action === "reject" && !reason) return fail("拒绝时必须填写理由");

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, userId: true, status: true },
    });
    if (!post) throw new AppError("帖子不存在", 404);
    if (post.status !== "pending") throw new AppError("该帖子已被处理", 409);

    const nextStatus = body.action === "approve" ? "approved" : "rejected";
    await prisma.post.update({
      where: { id: postId },
      data: { status: nextStatus, rejectReason: body.action === "reject" ? reason : null },
    });

    await audit({
      operatorId: admin.id,
      action: "post_moderate",
      targetType: "post",
      targetId: postId,
      detail: body.action === "reject" ? `拒绝：${reason}` : "批准",
    });

    // 拒绝时通知作者（失败静默，不阻断主流程）。
    if (body.action === "reject") {
      await notify({
        userId: post.userId,
        type: "system",
        title: "你的帖子未通过审核",
        body: reason,
        refType: "post",
        refId: postId,
      });
    }

    return ok({ id: postId, status: nextStatus });
  });
}
