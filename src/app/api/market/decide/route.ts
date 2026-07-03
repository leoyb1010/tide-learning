import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { ensureAccount } from "@/lib/credits";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// 课程被学习：作者奖励积分额度。
const SHARE_REWARD = 10;

/**
 * POST /api/market/decide — 作者批准/拒绝一条学习申请。
 * 入参：{ requestId, approve:boolean }
 * 校验：登录 + request.ownerId===user.id（越权铁律：只有课程作者能决定自己收到的申请）。
 * 防重复决定：已 decided（非 pending）的申请直接 fail。
 * approve：status=approved + decidedAt，给作者奖励积分（grantCredits），notify 申请者(access_approved)。
 * reject ：status=rejected + decidedAt，notify 申请者(access_rejected)。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    assertUserRateLimit(user.id, "market_decide", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { requestId?: string; approve?: boolean } | null;
    const requestId = body?.requestId?.trim();
    if (!requestId) return fail("缺少申请参数");
    if (typeof body?.approve !== "boolean") return fail("缺少决定参数");
    const approve = body.approve;

    // 越权铁律：where 锁 ownerId=user.id，别人的申请查不出。
    const request = await prisma.courseAccessRequest.findFirst({
      where: { id: requestId, ownerId: user.id },
      select: { id: true, status: true, requesterId: true, ownerId: true, courseId: true },
    });
    if (!request) throw new AppError("申请不存在或你无权处理", 404);

    // 防重复决定：仅 pending 可被处理。
    if (request.status !== "pending") {
      return fail(request.status === "approved" ? "该申请已批准" : "该申请已拒绝");
    }

    // 课程标题用于通知文案。
    const course = await prisma.course.findUnique({
      where: { id: request.courseId },
      select: { title: true },
    });
    const courseTitle = course?.title ?? "课程";

    if (approve) {
      // 确保作者积分账户存在（惰性创建 + 注册赠送，与 grantCredits 语义一致；在事务外）。
      await ensureAccount(request.ownerId);

      // 批准状态翻转 + 作者积分入账在同一事务：要么同成要么同败（防批准成功但积分丢失）。
      // 事务内再次确认仍是 pending（防并发双击重复奖励），并手写记账（余额 + 流水）。
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.courseAccessRequest.updateMany({
          where: { id: request.id, status: "pending" },
          data: { status: "approved", decidedAt: new Date() },
        });
        if (updated.count === 0) return { ok: false as const };

        const acc = await tx.creditAccount.findUniqueOrThrow({ where: { userId: request.ownerId } });
        const balanceAfter = acc.balance + SHARE_REWARD;
        await tx.creditAccount.update({
          where: { userId: request.ownerId },
          data: { balance: balanceAfter, totalEarned: acc.totalEarned + SHARE_REWARD },
        });
        await tx.creditLedger.create({
          data: {
            userId: request.ownerId,
            delta: SHARE_REWARD,
            type: "share_reward",
            refId: request.id,
            balanceAfter,
            reason: "课程被学习",
          },
        });
        return { ok: true as const };
      });
      if (!result.ok) return fail("该申请已被处理");

      // 通知申请者：申请通过（事务外，通知失败不回滚业务）。
      await notify({
        userId: request.requesterId,
        type: "access_approved",
        title: `你申请学习的《${courseTitle}》已通过`,
        body: "现在可以开始学习了",
        refType: "course",
        refId: request.courseId,
      });
      await track({ eventName: "market_decide", userId: user.id, properties: { requestId: request.id, approve: true, reward: SHARE_REWARD } });
      return ok({ status: "approved", reward: SHARE_REWARD, message: `已批准，获得 ${SHARE_REWARD} 积分奖励` });
    }

    // 拒绝：原子标记（同样防并发）。
    const updated = await prisma.courseAccessRequest.updateMany({
      where: { id: request.id, status: "pending" },
      data: { status: "rejected", decidedAt: new Date() },
    });
    if (updated.count === 0) return fail("该申请已被处理");

    await notify({
      userId: request.requesterId,
      type: "access_rejected",
      title: `你申请学习的《${courseTitle}》未通过`,
      refType: "course",
      refId: request.courseId,
    });
    await track({ eventName: "market_decide", userId: user.id, properties: { requestId: request.id, approve: false } });
    return ok({ status: "rejected", message: "已拒绝该申请" });
  });
}
