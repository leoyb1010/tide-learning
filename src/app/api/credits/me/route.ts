import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/credits/me — 当前用户积分概览。
 * 返回 { balance, recentLedger }：最近 10 条流水（入账/消耗）。
 * 所有查询强制 where userId（越权铁律）。
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();

    const [balance, ledger] = await Promise.all([
      getBalance(user.id),
      prisma.creditLedger.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { delta: true, type: true, reason: true, createdAt: true, balanceAfter: true },
      }),
    ]);

    const recentLedger = ledger.map((l) => ({
      delta: l.delta,
      type: l.type,
      reason: l.reason,
      createdAt: l.createdAt.toISOString(),
      balanceAfter: l.balanceAfter,
    }));

    return ok({ balance, recentLedger });
  });
}
