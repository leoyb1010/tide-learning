import { prisma } from "./db";
import { Prisma } from "@prisma/client";
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

/**
 * 按月加法并钳制月末溢出：1/31 + 1 月不该溢出到 3/3，应落到 2 月最后一天。
 * 记下目标 day，setMonth 后若 getDate() 变了（说明目标月天数不足溢出到下月），
 * 用 setDate(0) 退回目标月最后一天。setFullYear 走同一路径（覆盖 2/29 + 1 年 → 2/28）。
 */
export function addMonthsClamped(d: Date, months: number): void {
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== targetDay) d.setDate(0);
}

function periodEnd(billingPeriod: string, from = new Date()): Date {
  const d = new Date(from);
  if (billingPeriod === "year") addMonthsClamped(d, 12);
  else if (billingPeriod === "quarter") addMonthsClamped(d, 3);
  else addMonthsClamped(d, 1); // month / month_recurring
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

  let committed = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { externalOrderId: payload.externalOrderId },
        include: { plan: true, coupon: true },
      });
      if (!order) throw new AppError("订单不存在");

      if (payload.eventType === "payment.succeeded") {
        if (order.status === "paid") return { ok: true, duplicate: true };
        // 乱序防护：已退款订单再收到 succeeded（渠道重投/事件乱序）按重复忽略——
        // 绝不把 refunded 覆写回 paid，也不激活订阅/核销优惠券；写审计留痕便于对账排查。
        if (order.status === "refunded") {
          try {
            await tx.auditLog.create({
              data: {
                operatorId: order.userId,
                action: "webhook_out_of_order",
                targetType: "order",
                targetId: order.id,
                detail: JSON.stringify({ eventType: payload.eventType, externalId: payload.externalId, orderStatus: order.status }),
              },
            });
          } catch {
            /* 审计写失败不阻断（与 coupon_oversell 审计同策略） */
          }
          return { ok: true, duplicate: true };
        }

        // 优惠券核销闭环（流3-U4b）：先建核销记录占位，(couponId,orderId) 唯一约束保证
        // 同一订单在 webhook 重放/并发下只有一次核销通过；再在事务内条件自增 redeemedCount，
        // updateMany + count<maxRedeem 二次核验保证并发下不超发（A1-14）。
        if (order.couponId && order.coupon) {
          // 钱已收 → 订单必须激活：优惠券核销只做「记录」，任何营销名额/幂等冲突都不得回滚已付款事务。
          let alreadyRedeemed = false;
          try {
            await tx.couponRedemption.create({
              data: { couponId: order.couponId, userId: order.userId, orderId: order.id },
            });
          } catch (e) {
            // 仅唯一冲突(P2002) = 本单已核销过（webhook 重放）：跳过自增（本就幂等），不 throw、不回滚。
            // 其它异常（连接抖动/FK 等）是真错误：rethrow 让本事务回滚，由渠道重投重新原子处理，
            // 不静默把未知失败当成「已核销」而污染 redeemedCount 对账。
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
              alreadyRedeemed = true;
            } else {
              throw e;
            }
          }
          if (!alreadyRedeemed) {
            if (order.coupon.maxRedeem > 0) {
              const claimed = await tx.coupon.updateMany({
                where: { id: order.couponId, redeemedCount: { lt: order.coupon.maxRedeem } },
                data: { redeemedCount: { increment: 1 } },
              });
              // 名额抢不到（已超发）：不 throw 回滚，记一条审计后继续激活订阅（钱已收不能拒绝履约）。
              if (claimed.count === 0) {
                console.warn(`[payment] 优惠券超发放行：couponId=${order.couponId} orderId=${order.id}（名额已满仍激活订阅）`);
                try {
                  await tx.auditLog.create({
                    data: {
                      operatorId: order.userId,
                      action: "coupon_oversell",
                      targetType: "coupon",
                      targetId: order.couponId,
                      detail: JSON.stringify({ orderId: order.id, maxRedeem: order.coupon.maxRedeem }),
                    },
                  });
                } catch {
                  /* 审计写失败不阻断履约 */
                }
              }
            } else {
              await tx.coupon.update({ where: { id: order.couponId }, data: { redeemedCount: { increment: 1 } } });
            }
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
        let refundSubId = order.subscriptionId;
        // 兜底：老订单 / seed 数据 / 早于 subscriptionId 字段的订单可能没写回 subscriptionId。
        // 此时不静默跳过（会导致退款后订阅仍生效、权益不撤），而是按 userId + 该 plan 的 scope
        // 反查该用户当前该赛道有效订阅，取最近到期的一条撤销。仍限定同 scope，不会误伤其它赛道订阅。
        if (!refundSubId) {
          const fallback = await tx.subscription.findFirst({
            where: {
              userId: order.userId,
              scope: order.plan.scope,
              status: { notIn: ["expired", "refunded", "revoked"] },
            },
            orderBy: { currentPeriodEnd: "desc" },
          });
          if (fallback) refundSubId = fallback.id;
        }
        if (refundSubId) {
          const sub = await tx.subscription.findUnique({ where: { id: refundSubId } });
          if (sub && sub.status !== "expired" && sub.status !== "refunded") {
            await tx.subscription.update({
              where: { id: sub.id },
              data: { status: "refunded", currentPeriodEnd: new Date() },
            });
          }
        }

        // 退款回退优惠券名额（不低于 0）+ 删核销记录：仅当本单确有核销记录时才回退，
        // 避免「未核销订单退款也扣名额」把 redeemedCount 扣穿。deleteMany 命中数即本单是否核销过。
        if (order.couponId) {
          const removed = await tx.couponRedemption.deleteMany({
            where: { couponId: order.couponId, orderId: order.id },
          });
          if (removed.count > 0) {
            await tx.coupon.updateMany({
              where: { id: order.couponId, redeemedCount: { gt: 0 } },
              data: { redeemedCount: { decrement: 1 } },
            });
          }
        }
        return { ok: true, refunded: true, userId: order.userId };
      }

      throw new AppError("未知事件类型");
    });

    // 事务已提交：订单/订阅落库成功，后续都是「不可回滚订单」的收尾。
    // committed 置真后，即便下面的收尾抛错也绝不能触发 catch 里的「删占位日志」补偿——
    // 那会把一笔已成功的支付误报失败、诱导渠道重投并毁掉幂等/审计日志。
    committed = true;

    // 事务外：刷新权益快照 + 埋点 + 成就 + 标记占位处理完成（非关键路径，失败不回滚订单、也不冒泡）。
    try {
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
    } catch (tailErr) {
      // 事务已提交，收尾失败只记日志，不影响已履约的订单，也不进入删除补偿分支。
      console.warn("[payment] webhook 事务后收尾失败（订单已激活，可忽略）：", tailErr);
    }
    return result;
  } catch (e) {
    // 仅当事务未提交（订单未激活）时才删除占位日志行，使同一 externalId 的渠道重试能重新进入处理
    // （不再被唯一约束误判重复）。保留占位并标 error 会毒化重试——create 撞唯一约束被当成「重复回调」
    // 直接放过，付款永久丢失。committed 后的异常绝不删日志：那笔支付已成功，重投由事务内幂等闸门挡下。
    if (logRef && !committed) {
      try {
        await prisma.paymentWebhookLog.delete({ where: { id: logRef.id } });
      } catch {
        // 删除自身失败（并发已删/连接异常）不掩盖原始异常，仅退化为「下次重试可能仍被判重复」
      }
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
