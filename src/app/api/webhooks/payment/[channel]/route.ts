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

    // 1. 原始 body 用于验签
    const rawBody = await req.text();
    const signature = req.headers.get("x-tide-signature");

    // 2. 验签失败直接拒绝
    if (!getProvider(channel).verifyWebhookSignature(rawBody, signature)) {
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

    const result = await processWebhook(channel, {
      eventType: body.eventType ?? "payment.succeeded",
      externalId: body.externalId ?? body.externalOrderId, // 幂等键
      externalOrderId: body.externalOrderId,
    });
    return ok(result);
  });
}
