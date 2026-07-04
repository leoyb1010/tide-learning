import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { ensureAccount } from "@/lib/credits";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/iap/verify — Apple 内购收据校验 + 发放（iOS StoreKit）。
 *
 * 入参：{ productId, transactionId, receiptData?(base64) | jwsRepresentation? }。
 *
 * 防重放（幂等）：以 transactionId 作幂等键。
 *   - 积分类：查 CreditLedger 是否已有 refId=transactionId 的入账，处理过则直接返回成功、不重复发放。
 *   - 订阅类：查 Order 是否已有 externalOrderId=iap_<transactionId> 的 paid 单，处理过则直接返回成功。
 *
 * 当前为 MVP/mock 模式（无 Apple 配置）：按 productId 映射直接发放。
 * 生产环境需接入真实 Apple 校验（见下方 TODO）。
 */

// —— productId → 发放映射（对齐文档，写死在顶部）——
// 积分类：productId → 到账积分数
const CREDIT_PRODUCTS: Record<string, number> = {
  credits_60: 60,
  credits_350: 350,
  credits_1300: 1300,
};
// 订阅类：productId → 计费周期（用于计算到期时间；scope 固定全站）
const SUBSCRIPTION_PRODUCTS: Record<string, { billingPeriod: "month" | "quarter" | "year"; planName: string }> = {
  sub_monthly: { billingPeriod: "month", planName: "iOS 内购·全站月卡" },
  sub_quarterly: { billingPeriod: "quarter", planName: "iOS 内购·全站季卡" },
  sub_yearly: { billingPeriod: "year", planName: "iOS 内购·全站年卡" },
};

const APPLE_IAP_CHANNEL = "apple_iap";

function periodEnd(billingPeriod: "month" | "quarter" | "year", from = new Date()): Date {
  const d = new Date(from);
  if (billingPeriod === "year") d.setFullYear(d.getFullYear() + 1);
  else if (billingPeriod === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * TODO（生产环境 Apple 真实校验）：
 *   接入 App Store Server API 的 verifyTransaction / Get Transaction Info，
 *   用 jwsRepresentation（JWS 签名）离线校验，或用 transactionId 在线拉取交易详情。
 *   必须校验：
 *     1. JWS 签名有效（Apple x5c 证书链，根为 Apple Root CA）；
 *     2. bundleId 与本 App 的 bundle 一致；
 *     3. environment（Sandbox / Production）与部署环境匹配；
 *     4. productId 与签名内容一致，transactionId 未被篡改。
 *   校验通过后再走下方发放逻辑（发放本身已按 transactionId 幂等）。
 */
async function verifyWithApple(_input: {
  productId: string;
  transactionId: string;
  jwsRepresentation?: string;
  receiptData?: string;
}): Promise<void> {
  // 未配置 Apple 凭据 → mock 模式，跳过真实校验。
  return;
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as
      | { productId?: string; transactionId?: string; receiptData?: string; jwsRepresentation?: string }
      | null;
    const productId = (body?.productId ?? "").trim();
    const transactionId = (body?.transactionId ?? "").trim();
    if (!productId || !transactionId) return fail("缺少 productId 或 transactionId");

    // 真实 Apple 校验（mock 模式为 no-op；生产按上方 TODO 接入）
    await verifyWithApple({
      productId,
      transactionId,
      jwsRepresentation: body?.jwsRepresentation,
      receiptData: body?.receiptData,
    });

    // —— 积分类充值 ——
    if (productId in CREDIT_PRODUCTS) {
      const amount = CREDIT_PRODUCTS[productId];

      // 幂等：以 (userId, type=recharge, refId=transactionId) 作幂等键。
      // 事务内「查重 → 入账」原子完成，二次确认放行闸门，杜绝并发同 transactionId 双发积分。
      // （CreditLedger 无法用 @@unique([type,refId])：llm_spend/monthly_grant 的 refId 天然重复，
      //   全局唯一会破坏计费/月赠契约；故用事务内二次确认，等价幂等且不改 schema。）
      await ensureAccount(user.id);
      const result = await prisma.$transaction(async (tx) => {
        const dup = await tx.creditLedger.findFirst({
          where: { userId: user.id, type: "recharge", refId: transactionId },
          select: { id: true },
        });
        if (dup) {
          const acc = await tx.creditAccount.findUnique({ where: { userId: user.id }, select: { balance: true } });
          return { balance: acc?.balance ?? 0, duplicate: true };
        }
        const acc = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
        const balanceAfter = acc.balance + amount;
        await tx.creditAccount.update({
          where: { userId: user.id },
          data: { balance: balanceAfter, totalEarned: acc.totalEarned + amount },
        });
        await tx.creditLedger.create({
          data: { userId: user.id, delta: amount, type: "recharge", refId: transactionId, reason: "IAP充值", balanceAfter },
        });
        return { balance: balanceAfter, duplicate: false };
      });

      if (result.duplicate) return ok({ balance: result.balance, duplicate: true });
      await track({ eventName: "iap_recharge", userId: user.id, properties: { product_id: productId, amount, transaction_id: transactionId } });
      return ok({ balance: result.balance });
    }

    // —— 订阅类 ——
    if (productId in SUBSCRIPTION_PRODUCTS) {
      const cfg = SUBSCRIPTION_PRODUCTS[productId];
      const externalOrderId = `iap_${transactionId}`;

      // 幂等：该 transactionId 对应的订单是否已处理（越权铁律无关，externalOrderId 全局唯一）
      const existingOrder = await prisma.order.findUnique({
        where: { externalOrderId },
        select: { id: true, status: true },
      });
      if (existingOrder && existingOrder.status === "paid") {
        const entitlement = await resolveEntitlement(user.id);
        return ok({ entitlement, duplicate: true });
      }

      // 找一个匹配周期的全站套餐做 planId 挂载（IAP 价格以 Apple 为准，这里仅取 plan 元数据）
      const plan = await prisma.plan.findFirst({
        where: { scope: "all", billingPeriod: cfg.billingPeriod, isActive: true },
        orderBy: { priceCents: "asc" },
      });
      if (!plan) throw new AppError("对应套餐未配置", 500);

      const start = new Date();
      const result = await prisma.$transaction(async (tx) => {
        // 记账订单（幂等键 externalOrderId 全局唯一，并发下重复插入会被 unique 拦截）
        const order = await tx.order.create({
          data: {
            userId: user.id,
            planId: plan.id,
            channel: APPLE_IAP_CHANNEL,
            amountCents: plan.priceCents,
            currency: plan.currency,
            status: "paid",
            externalOrderId,
            paidAt: start,
          },
        });

        // 已有同 scope 有效订阅 → 续期（叠加一个周期）；否则新建（对齐 payment.processWebhook 逻辑）
        const existing = await tx.subscription.findFirst({
          where: {
            userId: user.id,
            scope: "all",
            status: { in: ["trial", "active", "grace_period", "billing_retry", "canceled_but_active"] },
            currentPeriodEnd: { gte: start },
          },
          orderBy: { currentPeriodEnd: "desc" },
        });

        let sub;
        if (existing) {
          sub = await tx.subscription.update({
            where: { id: existing.id },
            data: {
              planId: plan.id,
              scope: "all",
              channel: APPLE_IAP_CHANNEL,
              status: existing.status === "canceled_but_active" ? "active" : existing.status,
              priceSnapshotCents: plan.priceCents,
              currentPeriodEnd: periodEnd(cfg.billingPeriod, existing.currentPeriodEnd),
              cancelAtPeriodEnd: false,
              billingRetryCount: 0,
            },
          });
        } else {
          sub = await tx.subscription.create({
            data: {
              userId: user.id,
              planId: plan.id,
              channel: APPLE_IAP_CHANNEL,
              scope: "all",
              status: "active",
              priceSnapshotCents: plan.priceCents,
              currentPeriodStart: start,
              currentPeriodEnd: periodEnd(cfg.billingPeriod, start),
              cancelAtPeriodEnd: false,
            },
          });
        }
        await tx.order.update({ where: { id: order.id }, data: { subscriptionId: sub.id } });
        return sub.id;
      });

      // 事务外：刷新权益快照 + 埋点
      const entitlement = await resolveEntitlement(user.id);
      await track({ eventName: "iap_subscription", userId: user.id, properties: { product_id: productId, subscription_id: result, transaction_id: transactionId } });
      return ok({ entitlement });
    }

    return fail("未知的 productId");
  });
}
