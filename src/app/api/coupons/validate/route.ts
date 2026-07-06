import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/coupons/validate — 校验优惠券码并返回折后价预览（D1，不落库）。
 * 计算口径与 payment.applyCoupon 保持一致：首单享 firstPriceCents（若配置）。
 * 校验券的可用性 / 适用范围 / 折扣，返回 { basePriceCents, discountCents, finalCents }。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    assertRateLimit(req, "coupon-validate", 30, 60_000); // 防枚举券码
    const user = await requireUser();
    const { code, planId } = (await req.json()) as { code?: string; planId?: string };
    if (!code) return fail("请输入优惠券码");
    if (!planId) return fail("请选择套餐");

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new AppError("套餐不可用");

    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.isActive) throw new AppError("优惠券无效");
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new AppError("优惠券已过期");
    if (coupon.maxRedeem > 0 && coupon.redeemedCount >= coupon.maxRedeem) throw new AppError("优惠券已被领完");
    if (coupon.planScope !== "any" && coupon.planScope !== planId) throw new AppError("优惠券不适用于该套餐");

    // 与结算一致：首单用首月价（口径对齐 payment.ts：paid/refunded 都算已下过单）
    const isFirstEver = (await prisma.order.count({ where: { userId: user.id, status: { in: ["paid", "refunded"] } } })) === 0;
    const basePriceCents = isFirstEver && plan.firstPriceCents != null ? plan.firstPriceCents : plan.priceCents;
    const discountCents = coupon.kind === "percent"
      ? Math.round((basePriceCents * Math.min(100, coupon.value)) / 100)
      : Math.min(basePriceCents, coupon.value);
    const finalCents = Math.max(0, basePriceCents - discountCents);

    return ok({
      code: coupon.code,
      kind: coupon.kind,
      basePriceCents,
      discountCents,
      finalCents,
      isFirstEver,
    });
  });
}
