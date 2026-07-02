import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/orders — 订单与订阅查询（§8.2.4）
export async function GET() {
  return handle(async () => {
    await requirePermission("order:read");
    const [orders, webhookLogs] = await Promise.all([
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { plan: true, user: { select: { nickname: true, email: true, phone: true } } },
      }),
      prisma.paymentWebhookLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return ok({ orders, webhookLogs });
  });
}
