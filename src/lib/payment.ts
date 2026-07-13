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

/**
 * periodEnd 的逆：从到期时间回退「一个计费周期」的时长。
 * 退款时用来精确扣掉「本笔订单贡献的那一段」，而不清零其他订单续期已付的周期。
 */
// 导出供 IAP 退款通知复用（审计 2026-07-12 P2-2）：精确回退一个计费周期，不清零同订阅其它已付周期。
export function rollbackOnePeriod(billingPeriod: string, end: Date): Date {
  const d = new Date(end);
  if (billingPeriod === "year") addMonthsClamped(d, -12);
  else if (billingPeriod === "quarter") addMonthsClamped(d, -3);
  else addMonthsClamped(d, -1); // month / month_recurring
  return d;
}

/**
 * 订阅激活/续期的**共享核心**（v3.3）——把此前内联在 iap/verify 与 processWebhook 里的
 * 「已有有效订阅→续期(叠加时长)，否则新建」逻辑提炼为一处，供三方复用且行为一致：
 *   1) iap/verify 的订阅发放（按周期）；
 *   2) 管理员「赠会员」/ 兑换码 membership 类（按天数）。
 * 与 iap/webhook 语义严格对齐：
 *   - 全站 scope（scope="all"）下找当前有效订阅（未过期的可续期态），有则延长有效期、否则新建；
 *   - canceled_but_active 续期后回到 active；trial 保持 trial（不误升级）。
 * 差异点仅在「延长多少」：这里按天数（days）叠加，避免与按月钳制耦合；
 * 从「原到期时间与当下的较晚者」起算，既不缩短远期权益也不凭空延长已过期订阅。
 *
 * 入参 tx 为 Prisma 事务客户端（Prisma.TransactionClient）：调用方须在一个 $transaction 内传入，
 * 保证「找/建订阅」与调用方的其他写（如兑换核销记录）同事务原子提交。
 * 返回激活/续期后的订阅 id；权益快照由调用方在事务外 resolveEntitlement 刷新。
 */
export async function activateMembershipDays(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    planId: string;
    channel: string;
    days: number;
    scope?: string;
    priceSnapshotCents?: number;
  },
): Promise<string> {
  const { userId, planId, channel } = params;
  const scope = params.scope ?? "all";
  const days = Math.max(1, Math.floor(params.days));
  const priceSnapshotCents = params.priceSnapshotCents ?? 0;
  const now = new Date();

  // 同 scope 下已有有效订阅 → 续期（叠加天数）；否则新建（对齐 iap/verify、processWebhook）。
  const existing = await tx.subscription.findFirst({
    where: {
      userId,
      scope,
      status: { in: ["trial", "active", "grace_period", "billing_retry", "canceled_but_active"] },
      currentPeriodEnd: { gte: now },
    },
    orderBy: { currentPeriodEnd: "desc" },
  });

  if (existing) {
    // 从「原到期时间与当下的较晚者」往后叠加天数（远期权益不缩短，过期订阅不凭空延长）。
    const from = existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
    const end = new Date(from.getTime() + days * 864e5);
    const sub = await tx.subscription.update({
      where: { id: existing.id },
      data: {
        planId,
        scope,
        channel,
        // canceled_but_active 续期回 active；其余状态保持（trial 不误升级）。
        status: existing.status === "canceled_but_active" ? "active" : existing.status,
        priceSnapshotCents,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        billingRetryCount: 0,
      },
    });
    return sub.id;
  }

  const end = new Date(now.getTime() + days * 864e5);
  const sub = await tx.subscription.create({
    data: {
      userId,
      planId,
      channel,
      scope,
      status: "active",
      priceSnapshotCents,
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
    },
  });
  return sub.id;
}

/**
 * 为某用户挑一个用于「赠会员/兑换会员」挂载的套餐（Subscription 必须挂 planId）。
 * 优先用调用方指定的 planId；否则取任一全站(scope="all")启用套餐（价格最低者，元数据最小惊讶）。
 * 找不到任何套餐时抛错（种子数据保证至少存在全站套餐）。
 */
export async function resolveGrantPlan(preferredPlanId?: string | null) {
  if (preferredPlanId) {
    const p = await prisma.plan.findUnique({ where: { id: preferredPlanId } });
    if (!p) throw new AppError("指定套餐不存在");
    if (!p.isActive) throw new AppError("指定套餐已停用");
    return p;
  }
  const plan = await prisma.plan.findFirst({
    where: { scope: "all", isActive: true },
    orderBy: { priceCents: "asc" },
  });
  if (!plan) throw new AppError("未配置可用的全站套餐，无法发放会员", 500);
  return plan;
}

/** 校验并结算优惠券，返回折扣分、券 id 与名额上限（maxRedeem 供下单时原子预留用，P2-1）。 */
async function applyCoupon(code: string | undefined, planId: string, baseCents: number) {
  if (!code) return { discountCents: 0, couponId: null as string | null, couponMaxRedeem: 0 };
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.isActive) throw new AppError("优惠券无效");
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new AppError("优惠券已过期");
  if (coupon.maxRedeem > 0 && coupon.redeemedCount >= coupon.maxRedeem) throw new AppError("优惠券已被领完");
  if (coupon.planScope !== "any" && coupon.planScope !== planId) throw new AppError("优惠券不适用于该套餐");
  const discount = coupon.kind === "percent"
    ? Math.round((baseCents * Math.min(100, coupon.value)) / 100)
    : Math.min(baseCents, coupon.value);
  return { discountCents: discount, couponId: coupon.id, couponMaxRedeem: coupon.maxRedeem };
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

  // 首单资格看「是否曾经成功支付过」——退款(refunded)也算用过，杜绝「买-退-再买」反复薅首单价。
  // 竞态加固：近 30 分钟内的 pending 订单也占用资格，堵住「并发/连发多笔 pending 各按首单价计价、
  // 再逐一支付」薅多次首单价的窗口；又不惩罚早已放弃的历史 pending（那类用户回来仍应享首单价）。
  // 残留：亚秒级并发仍可能各读到 0（由 checkout 限流 20/分兜底），无 schema 级唯一约束不做过度设计。
  const priorConsuming = await prisma.order.count({
    where: {
      userId,
      OR: [
        { status: { in: ["paid", "refunded"] } },
        { status: "pending", createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      ],
    },
  });
  const isFirstEver = priorConsuming === 0;
  const base = isFirstEver && plan.firstPriceCents != null ? plan.firstPriceCents : plan.priceCents;
  const { discountCents, couponId, couponMaxRedeem } = await applyCoupon(couponCode, planId, base);
  const amount = Math.max(0, base - discountCents);

  // P0-2：先校验渠道 provider，再落订单。不支持渠道 / 生产禁用 mock 时直接拒绝，
  // 绝不先创建 pending 订单——否则失败请求会在订单列表/财务对账留下用户从未进入收银台的孤儿单。
  const provider = getProvider(channel);
  if (!provider) throw new AppError("不支持的支付渠道");

  const externalOrderId = channel + "_" + randomBytes(10).toString("hex");
  // 事务：创建订单 + 在**下单时**原子预留优惠券名额（审计 2026-07-12 P2-1）。
  // 此前折扣在下单时就计入金额，但 redeemedCount 直到支付回调才自增——N 个用户在任何人支付前并发下单
  // 都读到未满、全部拿折扣（并发超发），且无每人上限（同一用户可反复用同券），构成营销预算泄漏。
  // 现在下单即：① 全局名额 maxRedeem>0 时条件自增，抢不到→拒单；② 以 @@unique([couponId,userId]) 保证
  // 每人限一次（未支付的旧订单允许复用同一名额重试，已支付则拒绝）。webhook 因唯一约束天然幂等（不再重复自增），
  // 退款路径按 (couponId,orderId) 释放名额。
  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
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
    if (couponId) {
      const existing = await tx.couponRedemption.findUnique({
        where: { couponId_userId: { couponId, userId } },
        select: { id: true, orderId: true },
      });
      if (existing) {
        // 该用户已对此券占过名额：仅当旧订单已支付才是「真的用过」→ 拒绝；
        // 旧订单仍 pending/failed（放弃后重试）→ 复用名额、改指向新订单，不重复自增全局名额。
        const prev = await tx.order.findUnique({ where: { id: existing.orderId }, select: { status: true } });
        if (prev && prev.status === "paid") throw new AppError("该优惠券每人限用一次");
        await tx.couponRedemption.update({ where: { id: existing.id }, data: { orderId: o.id } });
      } else {
        if (couponMaxRedeem > 0) {
          const claimed = await tx.coupon.updateMany({
            where: { id: couponId, redeemedCount: { lt: couponMaxRedeem } },
            data: { redeemedCount: { increment: 1 } },
          });
          if (claimed.count === 0) throw new AppError("优惠券已被领完");
        } else {
          await tx.coupon.update({ where: { id: couponId }, data: { redeemedCount: { increment: 1 } } });
        }
        await tx.couponRedemption.create({ data: { couponId, userId, orderId: o.id } });
      }
    }
    return o;
  });

  // P0-2：收银台票据创建失败（真实渠道网络/配置异常）时补偿——把刚建的订单标记为 failed（可追踪、
  // 不计入 pending/首单判定），绝不静默留 pending。mock provider 不会抛，此路径服务于真实渠道。
  let ticket;
  try {
    ticket = await provider.createCheckout({
      orderId: order.id,
      externalOrderId,
      amountCents: amount,
      currency: plan.currency,
      subject: plan.name,
    });
  } catch (e) {
    await prisma.order.update({ where: { id: order.id }, data: { status: "failed" } }).catch(() => {});
    throw e;
  }

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
      // 渠道匹配（防御纵深）：订单按 externalOrderId 全局查找，须校验回调渠道与下单渠道一致，
      // 否则持任一渠道密钥者可对其他渠道的订单发确认/退款回调。
      if (order.channel !== channel) throw new AppError("订单渠道不匹配");

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

        // 优惠券核销闭环（流3-U4b）：P2-1 起名额已在**下单时**原子预留（createCheckoutSession），
        // 该订单的 CouponRedemption 行通常已存在——此处 create 撞唯一约束(P2002)即 alreadyRedeemed=true、
        // 跳过自增，天然幂等、不重复计数。仅对 P2-1 之前创建的**存量订单**（无预留行）走 create+自增的旧路径。
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
            // 精确回退「本笔订单贡献的那段周期」，不清零其他订单续期已付的时长（修 P1）。
            // 续期复用同一订阅行：退首单不应把后续续费已付的周期一并作废。
            const now = new Date();
            const rolledBack = rollbackOnePeriod(order.plan.billingPeriod, sub.currentPeriodEnd);
            if (rolledBack > now) {
              // 回退后到期时间仍在未来（有其他订单续期撑着）→ 订阅继续有效，仅缩短有效期，状态不改。
              await tx.subscription.update({
                where: { id: sub.id },
                data: { currentPeriodEnd: rolledBack },
              });
            } else {
              // 回退后已到期 → 本单是唯一/最后支撑，订阅置退款并即时失效。
              await tx.subscription.update({
                where: { id: sub.id },
                data: { status: "refunded", currentPeriodEnd: now },
              });
            }
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

  // Apple 自动续费商品的订阅须在 App Store 侧变更；Web 端改 plan 会与 IAP 商品脱钩、续费错乱。
  if (sub.channel === "apple_iap") {
    throw new AppError("App Store 订阅请在系统「订阅」中变更");
  }

  // scope 覆盖判定：全站(all)覆盖一切赛道，可向下切到任意单赛道（降级）；
  // 但单赛道订阅只能在「同一 scope 内」改 plan（仅调价档），不得横跳到另一赛道——
  // 否则同价单赛道之间可无限「平级」横跳，一份钱串行消费多个赛道内容（修越权/薅课）。
  const scopeCovered = sub.scope === "all" || plan.scope === sub.scope;
  if (!scopeCovered) {
    throw new AppError("不支持跨赛道变更套餐，请就目标赛道单独下单");
  }

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
