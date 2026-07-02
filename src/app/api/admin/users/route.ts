import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/users — 用户查询（§8.2.4）
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        _count: { select: { notes: true, orders: true } },
        subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 1 },
      },
    });
    return ok({
      users: users.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        email: u.email,
        phone: u.phone,
        role: u.role,
        createdAt: u.createdAt,
        notesCount: u._count.notes,
        ordersCount: u._count.orders,
        subscriptionStatus: u.subscriptions[0]?.status ?? "free",
      })),
    });
  });
}
