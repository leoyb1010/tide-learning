import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { resolveEntitlement } from "@/lib/entitlement";
import { isAppleConfigured, verifySignedJws, appleEnvironment } from "@/lib/apple-iap";
import { rollbackOnePeriod } from "@/lib/payment";

export const dynamic = "force-dynamic";

/**
 * POST /api/iap/notifications — Apple App Store Server Notifications V2（退款/撤销回收）。
 *
 * 补齐 IAP 的退款回收通道（此前只在 iap/verify 时点检查 revocationDate）：用户先兑付
 * 积分/订阅、再向 Apple 申请退款时，服务端永远收不到撤销通知 → 权益/积分保留形成资损。
 * Apple 在退款/撤销后向本端点推 signedPayload；此处验签后撤销对应订阅并回收消耗型积分。
 *
 * 认证：无 session、无同源校验——来源是 Apple 服务器，安全性完全由 JWS 签名保证
 *       （与 webhook/payment 同理），再叠加按 IP 限流防洪泛。
 * 幂等：复用 PaymentWebhookLog(channel=apple_iap, externalId=notificationUUID) 原子占位。
 */

const APPLE_IAP_CHANNEL = "apple_iap";
// 需撤销权益的通知类型：退款 / 撤销（家庭共享移除等）。其余（DID_RENEW/SUBSCRIBED…）确认接收即可，发放走 verify。
const REVOKING_TYPES = new Set(["REFUND", "REVOKE"]);

/** 解码一段 Apple JWS：已配置 Apple 时强制验签；未配置且非生产时按明文 JSON 测试载荷处理。 */
function decodeAppleJws(jws: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  if (isAppleConfigured()) return verifySignedJws(jws);
  if (process.env.NODE_ENV === "production") {
    return { ok: false, reason: "生产环境未配置 Apple JWS 校验参数" };
  }
  try {
    return { ok: true, payload: JSON.parse(jws) as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "未配置 Apple 校验时，测试载荷须为明文 JSON" };
  }
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertRateLimit(req, "iap-notify", 120, 60_000);
    // 生产总开关（与 iap/verify 对齐）：未启用即拒，避免半配置状态下误处理。
    if (process.env.NODE_ENV === "production" && process.env.APPLE_IAP_ENABLED !== "1") {
      return fail("内购通知未启用", 403);
    }

    const body = (await req.json().catch(() => null)) as { signedPayload?: string } | null;
    const signedPayload = body?.signedPayload?.trim();
    if (!signedPayload) return fail("缺少 signedPayload");

    const decoded = decodeAppleJws(signedPayload);
    if (!decoded.ok) {
      console.error(`[iap/notify] 通知验签失败：${decoded.reason}`);
      return fail("通知校验失败", 400);
    }
    const notification = decoded.payload;
    const notificationType = String(notification.notificationType ?? "");
    const notificationUUID = String(notification.notificationUUID ?? "");
    const data = (notification.data ?? {}) as Record<string, unknown>;
    if (!notificationType) return fail("通知缺少 notificationType");

    // 只处理需撤销的类型；其余确认接收（避免 Apple 侧重投），不做任何写。
    if (!REVOKING_TYPES.has(notificationType)) {
      return ok({ received: true, notificationType, handled: false });
    }

    // 取内嵌交易 JWS，拿经签名验证的 transactionId / originalTransactionId + bundleId/environment 一致性。
    let txId = "";
    let originalTxId = "";
    const signedTx = typeof data.signedTransactionInfo === "string" ? data.signedTransactionInfo : "";
    if (signedTx) {
      const txDecoded = decodeAppleJws(signedTx);
      if (!txDecoded.ok) {
        console.error(`[iap/notify] 交易 JWS 验签失败：${txDecoded.reason}`);
        return fail("通知交易校验失败", 400);
      }
      const t = txDecoded.payload;
      txId = String(t.transactionId ?? "");
      originalTxId = String(t.originalTransactionId ?? "");
      if (isAppleConfigured()) {
        if (t.bundleId && t.bundleId !== process.env.APPLE_BUNDLE_ID) return fail("bundleId 不匹配", 400);
        if (t.environment && t.environment !== appleEnvironment()) return fail("environment 不匹配", 400);
      }
    }
    // 顶层兜底（部分测试载荷直接带 id）
    txId = txId || String(data.transactionId ?? "");
    originalTxId = originalTxId || String(data.originalTransactionId ?? "");
    if (!txId && !originalTxId) return fail("通知缺少交易标识");

    const dedupKey = notificationUUID || `${notificationType}:${txId || originalTxId}`;

    // 幂等占位：唯一冲突即视为重投，直接确认。
    try {
      await prisma.paymentWebhookLog.create({
        data: {
          channel: APPLE_IAP_CHANNEL,
          eventType: notificationType,
          externalId: dedupKey,
          payloadJson: JSON.stringify({ notificationType, txId, originalTxId }),
          status: "received",
        },
      });
    } catch {
      return ok({ received: true, duplicate: true });
    }

    const affectedUserIds = new Set<string>();

    const result = await prisma.$transaction(async (tx) => {
      let revokedSub = false;
      let clawedCredits = 0;

      // 订阅类（审计 2026-07-12 P2-2 修复：过度回收）：
      // 一次 REFUND 只针对「具体退款的那笔交易(txId)」，故只精确回退该笔订单激活的订阅的**一个计费周期**，
      // 与 payment.processWebhook 退款对齐（rollbackOnePeriod），不再遍历 candidateOrderIds 把 original
      // 也一并 currentPeriodEnd=now 清零——那会误伤同订阅上 Web/其它续期已付的未退款周期。
      // 优先具体退款交易 txId 的订单，缺失才回退到 originalTxId。
      const refundEoid = txId ? `iap_${txId}` : `iap_${originalTxId}`;
      const fallbackEoid = originalTxId && `iap_${originalTxId}` !== refundEoid ? `iap_${originalTxId}` : null;
      let order = await tx.order.findUnique({
        where: { externalOrderId: refundEoid },
        select: { id: true, userId: true, status: true, subscriptionId: true, plan: { select: { billingPeriod: true } } },
      });
      if (!order && fallbackEoid) {
        order = await tx.order.findUnique({
          where: { externalOrderId: fallbackEoid },
          select: { id: true, userId: true, status: true, subscriptionId: true, plan: { select: { billingPeriod: true } } },
        });
      }
      if (order) {
        affectedUserIds.add(order.userId);
        if (order.status !== "refunded") {
          await tx.order.update({ where: { id: order.id }, data: { status: "refunded" } });
        }
        if (order.subscriptionId) {
          const sub = await tx.subscription.findUnique({ where: { id: order.subscriptionId } });
          if (sub && sub.status !== "refunded" && sub.status !== "expired") {
            const now = new Date();
            const rolledBack = rollbackOnePeriod(order.plan.billingPeriod, sub.currentPeriodEnd);
            if (rolledBack > now) {
              // 回退一个周期后仍在未来（有其它续期已付撑着）→ 仅缩短有效期，状态不改、不误伤未退款周期。
              await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: rolledBack } });
            } else {
              // 回退后已到期 → 本笔是唯一/最后支撑，置退款即时失效。
              await tx.subscription.update({
                where: { id: sub.id },
                data: { status: "refunded", currentPeriodEnd: now },
              });
            }
            revokedSub = true;
          }
        }
      }

      // 消耗型积分：按 refId 的 recharge 流水回收（负流水 + 扣余额，允许负债；(type=refund,refId) 幂等）。
      for (const rid of [txId, originalTxId].filter(Boolean)) {
        const recharge = await tx.creditLedger.findFirst({
          where: { type: "recharge", refId: rid },
          select: { delta: true, userId: true },
        });
        if (!recharge) continue;
        const already = await tx.creditLedger.findFirst({
          where: { type: "refund", refId: rid },
          select: { id: true },
        });
        if (already) continue;
        const updated = await tx.creditAccount.update({
          where: { userId: recharge.userId },
          data: { balance: { decrement: recharge.delta } },
        });
        await tx.creditLedger.create({
          data: {
            userId: recharge.userId,
            delta: -recharge.delta,
            type: "refund",
            refId: rid,
            reason: "IAP退款回收",
            balanceAfter: updated.balance,
          },
        });
        affectedUserIds.add(recharge.userId);
        clawedCredits += recharge.delta;
      }

      return { revokedSub, clawedCredits };
    });

    // 事务外：刷新受影响用户权益快照（非关键路径，失败不回滚已撤销状态）。
    for (const uid of affectedUserIds) {
      await resolveEntitlement(uid).catch(() => {});
    }
    // 标记处理完成（best-effort）。
    await prisma.paymentWebhookLog
      .updateMany({
        where: { channel: APPLE_IAP_CHANNEL, externalId: dedupKey },
        data: { status: "processed", processedAt: new Date() },
      })
      .catch(() => {});

    return ok({ received: true, notificationType, revokedSub: result.revokedSub, clawedCredits: result.clawedCredits });
  });
}
