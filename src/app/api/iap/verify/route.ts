import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { ensureAccount } from "@/lib/credits";
import { addMonthsClamped } from "@/lib/payment";
import { resolveEntitlement } from "@/lib/entitlement";
import { track } from "@/lib/analytics";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { verifyAppleTransaction } from "@/lib/apple-iap";

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
 * Apple 校验（verifyWithApple → src/lib/apple-iap.ts）：已配置 APPLE_BUNDLE_ID /
 * APPLE_IAP_ENVIRONMENT 时对 jwsRepresentation 做完整 JWS + 证书链 + claims 校验；
 * 未配置且非生产时走 mock 直发（本机/测试不变），生产则被闸门 + apple-iap 双重拦截。
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

// 复用 payment.ts 的月末钳制加法：1/31 + 1 月落到 2 月末、2/29 + 1 年落到 2/28，不溢出到下月。
function periodEnd(billingPeriod: "month" | "quarter" | "year", from = new Date()): Date {
  const d = new Date(from);
  if (billingPeriod === "year") addMonthsClamped(d, 12);
  else if (billingPeriod === "quarter") addMonthsClamped(d, 3);
  else addMonthsClamped(d, 1);
  return d;
}

/**
 * 生产环境 Apple 真实校验（已实现，见 src/lib/apple-iap.ts）：
 *   离线校验 App Store Server API 的 jwsRepresentation（signedTransactionInfo，JWS 签名）。
 *   校验项：
 *     1. JWS 签名有效（Apple x5c 证书链，逐级签发校验 + 有效期，根到 Apple Root CA - G3）；
 *     2. bundleId 与 APPLE_BUNDLE_ID 一致；
 *     3. environment（Sandbox / Production）与 APPLE_IAP_ENVIRONMENT 匹配；
 *     4. productId 与签名内容一致，transactionId 与请求一致（未被篡改）；
 *     5. 过期 / 撤销的交易一律拒绝。
 *   校验通过后再走下方发放逻辑（发放本身已按 transactionId 幂等）。
 *
 * 校验失败：对客户端只回模糊错误（不泄漏内部原因），reason 落 console.error 供服务端排查。
 * 未配置 Apple（缺 APPLE_BUNDLE_ID / APPLE_IAP_ENVIRONMENT）时：
 *   非生产 → mock 放行（本机 / 测试直发不变）；生产 → 拒绝（apple-iap 内部双保险）。
 */
async function verifyWithApple(input: {
  productId: string;
  transactionId: string;
  jwsRepresentation?: string;
  receiptData?: string;
}): Promise<void> {
  const result = await verifyAppleTransaction(input);
  if (!result.ok) {
    // 内部原因仅记服务端日志；对客户端统一「内购校验失败」，不泄漏证书/签名/claims 细节。
    console.error(`[iap/verify] Apple 校验失败 tx=${input.transactionId} product=${input.productId}: ${result.reason}`);
    throw new AppError("内购校验失败", 400);
  }
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    // P0-1 生产闸门：verifyWithApple 现已接入真实 Apple 校验（apple-iap.ts），但仍保留此闸门作总开关——
    // 置 APPLE_IAP_ENABLED=1 前须先配好 APPLE_BUNDLE_ID / APPLE_IAP_ENVIRONMENT（否则 apple-iap 生产分支亦会拒绝）。
    // 非生产（本机 / 测试）无此闸门，未配 Apple 时走 mock 直发，行为不变。
    if (process.env.NODE_ENV === "production" && process.env.APPLE_IAP_ENABLED !== "1") {
      return fail("内购校验未启用", 403);
    }
    // P0-1 按用户限流：发放为高价值敏感操作，按账号限每分钟 10 次，防暴力重放 / 刷量。
    assertUserRateLimit(user.id, "iap-verify", 10, 60_000);

    const body = (await req.json().catch(() => null)) as
      | { productId?: string; transactionId?: string; receiptData?: string; jwsRepresentation?: string }
      | null;
    const productId = (body?.productId ?? "").trim();
    const transactionId = (body?.transactionId ?? "").trim();
    if (!productId || !transactionId) return fail("缺少 productId 或 transactionId");

    // 真实 Apple 校验（已实现，见 apple-iap.ts）：失败即抛 AppError("内购校验失败",400)，
    // 由 handle 统一转成 fail；未配置且非生产时走 mock 放行，本机/测试直发不变。
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
        // 原子入账：balance/totalEarned 由 DB 侧 increment（对齐 credits.ts grantCredits），
        // 避免「读余额-算-整值覆盖」在并发下互相覆盖；update 返回更新后行，balanceAfter 直接取用。
        const updated = await tx.creditAccount.update({
          where: { userId: user.id },
          data: { balance: { increment: amount }, totalEarned: { increment: amount } },
        });
        const balanceAfter = updated.balance;
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
