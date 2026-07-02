import { prisma } from "./db";
import { randomBytes } from "crypto";
import { resolveEntitlement } from "./entitlement";
import { track } from "./analytics";
import { AppError } from "./api";
import { getProvider } from "./payment-provider";
import { unlockAchievement } from "./gamification";

/**
 * 支付与订阅 — 计划书 v0.3 §7.3 + D1 真实化。
 * - 渠道经 payment-provider 抽象；webhook 必须验签（见 webhook 路由）。
 * - 幂等 + 订单激活在单事务内完成（A1-9）。
 * - 状态机：trial → active → grace_period → billing_retry → expired（A1-2）。
 */

function periodEnd(billingPeriod: string, from = new Date()): Date {
  const d = new Date(from);
  if (billingPeriod === "year") d.setFullYear(d.getFullYear() + 1);
  else if (billingPeriod === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1); // month / month_recurring
  return d;
}

/** 校验并结算优惠券，返回折扣分与券 id。 */
async function applyCoupon(code: string | undefined, planId: string, baseCents: number) {
  if (!code) return { discountCents: 0, couponId: null as string | null };
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.isActive) throw new AppError("优惠券无效");
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new AppError("优惠券已过期");
  if (coupon.maxRedeem > 0 && coupon.redeemedCount >= coupon.maxRedeem) throw new AppError("优惠券已被领完");
  if (coupon.planScope !== "any" && coupon.planScope !== planId) throw new AppError("优惠券不适用于该套餐");
  const discount = coupon.kind === "percent"
    ? Math.round((baseCents * Math.min(100, coupon.value)) / 100)
    : Math.min(baseCents, coupon.value);
  return { discountCents: discount, couponId: coupon.id };
}

/** 发起支付：创建 pending 订单，返回渠道收银台票据。 */
export async function createCheckoutSession(
  userId: string,
  planId: string,
  channel: string,
  couponCode?: string,
) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new AppError("套餐不可用");

  const isFirstEver = (await prisma.order.count({ where: { userId, status: "paid" } })) === 0;
  const base = isFirstEver && plan.firstPriceCents != null ? plan.firstPriceCents : plan.priceCents;
  const { discountCents, couponId } = await applyCoupon(couponCode, planId, base);
  const amount = Math.max(0, base - discountCents);

  const externalOrderId = channel + "_" + randomBytes(10).toString("hex");
  const order = await prisma.order.create({
    data: {
      userId, planId, channel,
      amountCents: amount,
      currency: plan.currency,
      status: "pending",
      externalOrderId,
      couponId,
      discountCents,
    },
  });

  const ticket = await getProvider(channel).createCheckout({
    orderId: order.id,
    externalOrderId,
    amountCents: amount,
    currency: plan.currency,
    subject: plan.name,
  });

  await track({ eventName: "checkout_start", userId, properties: { plan_id: planId, channel, coupon: couponCode ?? null } });
  return { orderId: order.id, externalOrderId, amountCents: amount, discountCents, channel, ticket };
}

/**
 * 幂等 webhook 处理（§7.3）。整个「查订单→激活订阅→写权益→记账」在事务内完成。
 * 调用方（webhook 路由）必须先完成验签。
 */
export async function processWebhook(channel: string, payload: {
  eventType: string;
  externalId: string; // 幂等键
  externalOrderId: string;
}) {
  // 幂等：先原子占位（unique 约束保证并发下只有一个成功）
  try {
    await prisma.paymentWebhookLog.create({
      data: {
        channel,
        eventType: payload.eventType,
        externalId: payload.externalId,
        payloadJson: JSON.stringify(payload),
        status: "received",
      },
    });
  } catch {
    // unique 冲突 → 重复回调
    return { ok: true, duplicate: true };
  }

  const logRef = await prisma.paymentWebhookLog.findUnique({
    where: { channel_externalId: { channel, externalId: payload.externalId } },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { externalOrderId: payload.externalOrderId },
        include: { plan: true, coupon: true },
      });
      if (!order) throw new AppError("订单不存在");

      if (payload.eventType === "payment.succeeded") {
        if (order.status === "paid") return { ok: true, duplicate: true };
        await tx.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date() } });
        if (order.couponId) {
          await tx.coupon.update({ where: { id: order.couponId }, data: { redeemedCount: { increment: 1 } } });
        }
        const start = new Date();
        const end = periodEnd(order.plan.billingPeriod, start);
        // A1-2：连续包月首期进入 trial（自动续费），其余为 active
        const status = order.plan.billingPeriod === "month_recurring" ? "trial" : "active";
        const sub = await tx.subscription.create({
          data: {
            userId: order.userId,
            planId: order.planId,
            channel,
            scope: order.plan.scope,
            status,
            priceSnapshotCents: order.plan.priceCents,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            cancelAtPeriodEnd: order.plan.billingPeriod !== "month_recurring",
          },
        });
        return { ok: true, subscriptionId: sub.id, userId: order.userId };
      }

      if (payload.eventType === "payment.refunded") {
        await tx.order.update({ where: { id: order.id }, data: { status: "refunded" } });
        await tx.subscription.updateMany({
          where: { userId: order.userId, planId: order.planId, status: { not: "expired" } },
          data: { status: "refunded", currentPeriodEnd: new Date() },
        });
        return { ok: true, refunded: true, userId: order.userId };
      }

      throw new AppError("未知事件类型");
    });

    // 事务外：刷新权益快照 + 埋点 + 成就（非关键路径，失败不回滚订单）
    if ("userId" in result && result.userId) {
      await resolveEntitlement(result.userId);
      if ("subscriptionId" in result) {
        await track({ eventName: "subscription_success", userId: result.userId, properties: { channel } });
        await unlockAchievement(result.userId, "first_subscribe").catch(() => {});
      }
    }
    if (logRef) {
      await prisma.paymentWebhookLog.update({ where: { id: logRef.id }, data: { status: "processed", processedAt: new Date() } });
    }
    return result;
  } catch (e) {
    if (logRef) {
      await prisma.paymentWebhookLog.update({
        where: { id: logRef.id },
        data: { status: "error", errorMessage: (e as Error).message },
      });
    }
    throw e;
  }
}

/** 取消订阅（§6.7：权益保留到周期结束）。 */
export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "trial", "grace_period"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub) throw new AppError("没有可取消的订阅");
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "canceled_but_active", cancelAtPeriodEnd: true },
  });
  return resolveEntitlement(userId);
}

/** 恢复购买（§7.3：跨端登录后重新归约权益）。 */
export async function restorePurchase(userId: string) {
  return resolveEntitlement(userId);
}

/**
 * D1：订阅升/降级——立即切换套餐，按剩余天数折算差价（简化：仅换 plan + scope + 价格快照）。
 * 真实计费应生成补差 / 退差订单，这里保证状态机与权益正确。
 */
export async function changeSubscriptionPlan(userId: string, newPlanId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "trial", "grace_period", "canceled_but_active"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub) throw new AppError("没有可变更的订阅");
  const plan = await prisma.plan.findUnique({ where: { id: newPlanId } });
  if (!plan || !plan.isActive) throw new AppError("目标套餐不可用");

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { planId: plan.id, scope: plan.scope, priceSnapshotCents: plan.priceCents, status: "active", cancelAtPeriodEnd: false },
  });
  await track({ eventName: "subscription_change", userId, properties: { to_plan: newPlanId } });
  return resolveEntitlement(userId);
}

/**
 * D1：续费扣款失败 → 进入 grace_period（保留权益 3 天），继续失败 → billing_retry → expired。
 * 由 cron / 对账任务调用；此处提供纯状态机逻辑。
 */
export async function handleBillingFailure(subscriptionId: string) {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new AppError("订阅不存在");
  const retry = sub.billingRetryCount + 1;
  let status = sub.status;
  let periodEndOverride: Date | undefined;
  if (retry === 1) {
    status = "grace_period";
    periodEndOverride = new Date(Date.now() + 3 * 864e5); // 宽限 3 天
  } else if (retry === 2) {
    status = "billing_retry";
  } else {
    status = "expired";
  }
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status, billingRetryCount: retry, ...(periodEndOverride ? { currentPeriodEnd: periodEndOverride } : {}) },
  });
  return resolveEntitlement(sub.userId);
}
