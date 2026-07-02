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

  // 首单资格看「是否曾经成功支付过」——退款(refunded)也算用过，杜绝「买-退-再买」反复薅首单价
  const priorPaidOrders = await prisma.order.count({
    where: { userId, status: { in: ["paid", "refunded"] } },
  });
  const isFirstEver = priorPaidOrders === 0;
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

  const provider = getProvider(channel);
  if (!provider) throw new AppError("不支持的支付渠道");
  const ticket = await provider.createCheckout({
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

        // 优惠券：在事务内条件自增，updateMany + count 检查保证并发下不超发（A1-14）
        if (order.couponId && order.coupon) {
          if (order.coupon.maxRedeem > 0) {
            const claimed = await tx.coupon.updateMany({
              where: { id: order.couponId, redeemedCount: { lt: order.coupon.maxRedeem } },
              data: { redeemedCount: { increment: 1 } },
            });
            if (claimed.count === 0) throw new AppError("优惠券已被领完");
          } else {
            await tx.coupon.update({ where: { id: order.couponId }, data: { redeemedCount: { increment: 1 } } });
          }
        }

        await tx.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date() } });

        const start = new Date();
        // 同 scope 下已有有效订阅时做续期（延长有效期），而非新建第二条并行订阅（A1-7）
        const existing = await tx.subscription.findFirst({
          where: {
            userId: order.userId,
            scope: order.plan.scope,
            status: { in: ["trial", "active", "grace_period", "billing_retry", "canceled_but_active"] },
            currentPeriodEnd: { gte: start },
          },
          orderBy: { currentPeriodEnd: "desc" },
        });

        let sub;
        if (existing) {
          // 续期：从原到期时间往后叠加一个周期，切到新 plan 的价格快照，清除待取消标记
          const end = periodEnd(order.plan.billingPeriod, existing.currentPeriodEnd);
          const status = order.plan.billingPeriod === "month_recurring" ? "active" : existing.status;
          sub = await tx.subscription.update({
            where: { id: existing.id },
            data: {
              planId: order.planId,
              scope: order.plan.scope,
              channel,
              status: status === "canceled_but_active" ? "active" : status,
              priceSnapshotCents: order.plan.priceCents,
              currentPeriodEnd: end,
              cancelAtPeriodEnd: false,
              billingRetryCount: 0,
            },
          });
        } else {
          const end = periodEnd(order.plan.billingPeriod, start);
          // A1-2：连续包月首期进入 trial（自动续费），其余为 active
          const status = order.plan.billingPeriod === "month_recurring" ? "trial" : "active";
          sub = await tx.subscription.create({
            data: {
              userId: order.userId,
              planId: order.planId,
              channel,
              scope: order.plan.scope,
              status,
              priceSnapshotCents: order.plan.priceCents,
              currentPeriodStart: start,
              currentPeriodEnd: end,
              // 连续包月自动续费；一次性套餐到期不续（由 billingPeriod 决定，不借用 cancelAtPeriodEnd 承载此语义）
              cancelAtPeriodEnd: false,
            },
          });
        }
        // 记录本单激活/续期的订阅，退款时据此精确定位
        await tx.order.update({ where: { id: order.id }, data: { subscriptionId: sub.id } });
        return { ok: true, subscriptionId: sub.id, userId: order.userId };
      }

      if (payload.eventType === "payment.refunded") {
        if (order.status === "refunded") return { ok: true, duplicate: true };
        await tx.order.update({ where: { id: order.id }, data: { status: "refunded" } });

        // 精确撤销「这一笔订单」激活的那条订阅，绝不波及该 plan 下的其他有效订阅（A1-6）
        if (order.subscriptionId) {
          const sub = await tx.subscription.findUnique({ where: { id: order.subscriptionId } });
          if (sub && sub.status !== "expired" && sub.status !== "refunded") {
            await tx.subscription.update({
              where: { id: sub.id },
              data: { status: "refunded", currentPeriodEnd: new Date() },
            });
          }
        }

        // 退款回退优惠券名额（不低于 0）
        if (order.couponId) {
          await tx.coupon.updateMany({
            where: { id: order.couponId, redeemedCount: { gt: 0 } },
            data: { redeemedCount: { decrement: 1 } },
          });
        }
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
 * D1：订阅升/降级。
 * MVP 计费策略（避免白嫖高档权益，A1-10）：
 *  - 升级到更贵套餐：需走支付补差流程（createCheckoutSession），此处直接拒绝，不无差价切换；
 *  - 平级/降级：立即切换 plan/scope/价格快照，剩余周期不变，下期按新价续费；
 *  - 已取消(canceled_but_active)订阅不允许通过「变更」复活为自动续费——应重新下单。
 */
export async function changeSubscriptionPlan(userId: string, newPlanId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["active", "trial", "grace_period"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  if (!sub) throw new AppError("没有可变更的订阅");
  const plan = await prisma.plan.findUnique({ where: { id: newPlanId } });
  if (!plan || !plan.isActive) throw new AppError("目标套餐不可用");
  if (plan.id === sub.planId) throw new AppError("已是当前套餐");

  // 升级（目标价更高）必须补差价：引导走支付流程，不在此免费切换
  if (plan.priceCents > sub.priceSnapshotCents) {
    throw new AppError("升级到更高套餐需补差价，请通过下单完成");
  }

  // 平级/降级：立即切 plan 与权益范围，剩余周期保留，下期按新价续费
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { planId: plan.id, scope: plan.scope, priceSnapshotCents: plan.priceCents },
  });
  await track({ eventName: "subscription_change", userId, properties: { to_plan: newPlanId } });
  return resolveEntitlement(userId);
}

/**
 * D1：续费扣款失败 → 进入 grace_period（保留权益 3 天），继续失败 → billing_retry → expired。
 * 由 cron / 对账任务调用；此处提供纯状态机逻辑。
 */
const BILLABLE_STATUSES = ["active", "trial", "grace_period", "billing_retry"];
export async function handleBillingFailure(subscriptionId: string) {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new AppError("订阅不存在");
  // 仅对仍处可续费状态的订阅生效：已 expired/refunded/canceled 的订阅绝不「复活」
  if (!BILLABLE_STATUSES.includes(sub.status)) {
    throw new AppError("该订阅当前状态不可进行续费重试");
  }
  const retry = sub.billingRetryCount + 1;
  let status = sub.status;
  let periodEndOverride: Date | undefined;
  if (retry === 1) {
    status = "grace_period";
    // 宽限期从「原到期时间与当下的较晚者」再顺延 3 天：既不缩短仍有效的远期权益，也不凭空延长已过期订阅
    const from = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    periodEndOverride = new Date(from.getTime() + 3 * 864e5);
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
