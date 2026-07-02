import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/subscription/me — 当前订阅 + 账单历史（Order） + 可切换套餐（D1）
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ subscription: null, orders: [], entitlement: null, switchablePlans: [] });
    const [subscription, orders, entitlement, plans] = await Promise.all([
      prisma.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { currentPeriodEnd: "desc" },
        include: { plan: true },
      }),
      prisma.order.findMany({ where: { userId: user.id }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
      resolveEntitlement(user.id),
      prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    ]);
    // 可切换套餐 = 除当前套餐外的全部在售套餐（供升/降级）
    const switchablePlans = plans.filter((p) => p.id !== subscription?.planId);
    return ok({ subscription, orders, entitlement, switchablePlans });
  });
}
