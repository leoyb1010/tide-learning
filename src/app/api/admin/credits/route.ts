import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

/**
 * GET /api/admin/credits?q=昵称|邮箱 — 用户积分查询。
 * 返回命中用户的 CreditAccount 余额 + 最近 20 条流水。权限同调账口(order:refund)。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requirePermission("order:refund");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (!q) return ok({ users: [] });

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ nickname: { contains: q } }, { email: { contains: q } }],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        nickname: true,
        email: true,
        creditAccount: { select: { balance: true, totalEarned: true, totalSpent: true } },
      },
    });

    // 为每个命中用户附最近流水（并发查询）
    const withLedger = await Promise.all(
      users.map(async (u) => {
        const ledger = await prisma.creditLedger.findMany({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, delta: true, type: true, reason: true, balanceAfter: true, createdAt: true },
        });
        return {
          id: u.id,
          nickname: u.nickname,
          email: u.email,
          balance: u.creditAccount?.balance ?? 0,
          totalEarned: u.creditAccount?.totalEarned ?? 0,
          totalSpent: u.creditAccount?.totalSpent ?? 0,
          ledger,
        };
      }),
    );

    return ok({ users: withLedger });
  });
}
