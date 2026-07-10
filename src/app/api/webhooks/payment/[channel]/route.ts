import { NextRequest } from "next/server";
import { processWebhook } from "@/lib/payment";
import { getProvider } from "@/lib/payment-provider";
import { ok, fail, handle } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/payment/:channel — 支付渠道回调（§7.3，A1-1）。
 * D1 真实化：
 *  1. 读取 raw body（验签必须用原始字节，不能先 JSON.parse 再序列化，避免字节漂移）。
 *  2. 取 header 'x-tide-signature'，用该渠道 provider 验签，失败返回 401。
 *  3. 验签通过后交给 processWebhook（事务 + 幂等）。
 * 说明：webhook 来源是渠道服务器（非浏览器），故不做同源校验——
 *      安全性完全由 HMAC 签名保证；再叠加按 IP 限流防洪泛。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  return handle(async () => {
    const { channel } = await params;
    assertRateLimit(req, `webhook:${channel}`, 120, 60_000);

    // P0：生产默认禁用 mock 渠道回调；仅当显式置 MOCK_PAY_ENABLED=1 时放行（供测试机演示支付）。
    // 与 checkout/mock-pay、credits/recharge 路由同一闸门；getProvider 层亦有兜底拒绝。
    if (channel === "mock" && process.env.NODE_ENV === "production" && process.env.MOCK_PAY_ENABLED !== "1") {
      return fail("mock 支付渠道仅限非生产环境", 403);
    }

    // 未知渠道：绝不回退到 mock provider，直接拒绝
    const provider = getProvider(channel);
    if (!provider) return fail("未知支付渠道", 400);

    // 1. 原始 body 用于验签
    const rawBody = await req.text();
    const signature = req.headers.get("x-tide-signature");

    // 2. 验签失败直接拒绝
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      return fail("签名校验失败", 401);
    }

    // 3. 解析并处理（processWebhook 内部保证事务 + 幂等）
    let body: { eventType?: string; externalId?: string; externalOrderId?: string };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return fail("回调数据格式错误");
    }
    if (!body.externalOrderId) return fail("缺少订单号");

    // 事件类型白名单（禁 fail-open）：缺省/未知事件一律拒绝。
    // 此前缺省按 payment.succeeded 处理——真实渠道字段名不同(如用 event 而非 eventType)时，
    // 任意签名合法的回调（含支付失败/关单）都会被误当成功支付而激活订单，接真渠道前必堵。
    const eventType = body.eventType;
    if (eventType !== "payment.succeeded" && eventType !== "payment.refunded") {
      return fail("不支持的事件类型", 400);
    }
    // 幂等键绑定事件类型：支付成功与退款是两个独立事件，即使渠道不提供 externalId
    // 也不能因回退到同一 externalOrderId 而让退款被误判为「支付回调的重复」而丢弃。
    const externalId = `${eventType}:${body.externalId ?? body.externalOrderId}`;

    const result = await processWebhook(channel, {
      eventType,
      externalId,
      externalOrderId: body.externalOrderId,
    });
    return ok(result);
  });
}
