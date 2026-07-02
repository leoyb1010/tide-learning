import { prisma } from "./db";
import { randomBytes } from "crypto";
import { resolveEntitlement } from "./entitlement";
import { track } from "./analytics";

/**
 * 支付与订阅 — 计划书 v0.3 §7.3。
 * MVP 用 mock 支付渠道模拟微信/支付宝/Stripe；所有回调经 processWebhook 幂等处理。
 * 真实接入时把 processWebhook 挂到各渠道的 webhook 路由即可，业务逻辑不变。
 */

function periodEnd(billingPeriod: string, from = new Date()): Date {
  const d = new Date(from);
  if (billingPeriod === "year") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // month / month_recurring
  return d;
}

/** 发起支付：创建 pending 订单，返回 mock 收银台信息。 */
export async function createCheckoutSession(userId: string, planId: string, channel: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new Error("套餐不可用");

  const isFirstEver = (await prisma.order.count({ where: { userId, status: "paid" } })) === 0;
  const amount = isFirstEver && plan.firstPriceCents != null ? plan.firstPriceCents : plan.priceCents;

  const externalOrderId = "mock_" + randomBytes(8).toString("hex");
  const order = await prisma.order.create({
    data: {
      userId,
      planId,
      channel,
      amountCents: amount,
      currency: plan.currency,
      status: "pending",
      externalOrderId,
    },
  });

  await track({ eventName: "checkout_start", userId, properties: { plan_id: planId, channel } });
  return { orderId: order.id, externalOrderId, amountCents: amount, channel };
}

/**
 * 幂等 webhook 处理（§7.3：所有支付回调必须幂等；记录原始 payload）。
 * eventType: payment.succeeded / payment.refunded
 */
export async function processWebhook(channel: string, payload: {
  eventType: string;
  externalId: string; // 幂等键
  externalOrderId: string;
}) {
  // 幂等：同 channel+externalId 只处理一次
  const existing = await prisma.paymentWebhookLog.findUnique({
    where: { channel_externalId: { channel, externalId: payload.externalId } },
  });
  if (existing) {
    return { ok: true, duplicate: true };
  }

  const log = await prisma.paymentWebhookLog.create({
    data: {
      channel,
      eventType: payload.eventType,
      externalId: payload.externalId,
      payloadJson: JSON.stringify(payload),
      status: "received",
    },
  });

  try {
    const order = await prisma.order.findFirst({
      where: { externalOrderId: payload.externalOrderId },
      include: { plan: true },
    });
    if (!order) throw new Error("订单不存在");

    if (payload.eventType === "payment.succeeded") {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "paid", paidAt: new Date() },
      });
      const start = new Date();
      const end = periodEnd(order.plan.billingPeriod, start);
      const status = order.plan.billingPeriod === "month_recurring" ? "active" : "active";
      const sub = await prisma.subscription.create({
        data: {
          userId: order.userId,
          planId: order.planId,
          channel,
          status,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: order.plan.billingPeriod !== "month_recurring",
        },
      });
      await resolveEntitlement(order.userId);
      await track({
        eventName: "subscription_success",
        userId: order.userId,
        properties: { plan_id: order.planId, price: order.amountCents, channel },
      });
      await prisma.paymentWebhookLog.update({
        where: { id: log.id },
        data: { status: "processed", processedAt: new Date() },
      });
      return { ok: true, subscriptionId: sub.id };
    }

    if (payload.eventType === "payment.refunded") {
      await prisma.order.update({ where: { id: order.id }, data: { status: "refunded" } });
      await prisma.subscription.updateMany({
        where: { userId: order.userId, planId: order.planId, status: { not: "expired" } },
        data: { status: "refunded", currentPeriodEnd: new Date() },
      });
      await resolveEntitlement(order.userId);
      await prisma.paymentWebhookLog.update({
        where: { id: log.id },
        data: { status: "processed", processedAt: new Date() },
      });
      return { ok: true, refunded: true };
    }

    throw new Error("未知事件类型");
  } catch (e) {
    await prisma.paymentWebhookLog.update({
      where: { id: log.id },
      data: { status: "error", errorMessage: (e as Error).message },
    });
    throw e;
  }
}

/** 取消订阅（§6.7：取消入口必须可见，权益保留到周期结束）。 */
export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "trial", "grace_period"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub) throw new Error("没有可取消的订阅");
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "canceled_but_active", cancelAtPeriodEnd: true },
  });
  return resolveEntitlement(userId);
}

/** 恢复购买（§7.3：必须支持恢复购买 / 跨端登录）。 */
export async function restorePurchase(userId: string) {
  return resolveEntitlement(userId);
}
