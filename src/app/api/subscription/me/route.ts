import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { ok, handle } from "@/lib/api";

// GET /api/subscription/me — 订阅与订单
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ subscription: null, orders: [], entitlement: null });
    const [subscription, orders, entitlement] = await Promise.all([
      prisma.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { currentPeriodEnd: "desc" },
        include: { plan: true },
      }),
      prisma.order.findMany({ where: { userId: user.id }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
      resolveEntitlement(user.id),
    ]);
    return ok({ subscription, orders, entitlement });
  });
}
