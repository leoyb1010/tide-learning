import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { grantCredits } from "@/lib/credits";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

/**
 * POST /api/admin/credits/adjust — 管理员手动调账（正=补偿入账 / 负=扣减）。
 * 安全：assertSameOrigin(CSRF) + requirePermission(order:refund，退款/权益补偿口子)。
 * 正数复用 grantCredits(原子写流水+余额)；负数走事务，不透支(扣到 0 为止？——不，负数需足额否则拒绝)。
 * 全程写 AuditLog(credit_adjust)。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requirePermission("order:refund");

    const body = (await req.json()) as { userId?: unknown; amount?: unknown; reason?: unknown };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!userId) return fail("缺少用户");
    if (!Number.isFinite(amount) || amount === 0) return fail("调账积分需为非零整数");
    if (Math.abs(amount) > 1_000_000) return fail("单次调账幅度过大");
    if (!reason) return fail("请填写调账原因（审计留痕）");

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true } });
    if (!target) return fail("目标用户不存在", 404);

    const detail = `${amount > 0 ? "+" : ""}${amount} · ${reason}`;

    let balanceAfter: number;
    if (amount > 0) {
      // 入账：复用积分核心（写 CreditLedger + CreditAccount，type=admin_adjust）
      balanceAfter = await grantCredits(userId, amount, "admin_adjust", { reason });
    } else {
      // 扣减：事务内校验足额（不允许负余额），写流水快照
      const deduct = -amount; // 正数
      balanceAfter = await prisma.$transaction(async (tx) => {
        const acc = await tx.creditAccount.findUnique({ where: { userId } });
        const balance = acc?.balance ?? 0;
        if (balance < deduct) {
          throw new AppError("余额不足，无法扣减到负值", 400);
        }
        const after = balance - deduct;
        await tx.creditAccount.update({
          where: { userId },
          data: { balance: after, totalSpent: (acc?.totalSpent ?? 0) + deduct },
        });
        await tx.creditLedger.create({
          data: { userId, delta: amount, type: "admin_adjust", balanceAfter: after, reason },
        });
        return after;
      });
    }

    await audit({
      operatorId: admin.id,
      action: "credit_adjust",
      targetType: "user",
      targetId: userId,
      detail,
    });

    return ok({ userId, nickname: target.nickname, delta: amount, balance: balanceAfter });
  });
}
