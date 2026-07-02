import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";

// GET /api/pricing — 订阅套餐（§7.1）
export async function GET() {
  return handle(async () => {
    const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } });
    return ok({ plans });
  });
}
