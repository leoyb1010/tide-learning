import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { processWebhook } from "@/lib/payment";
import { signPayload, getProvider } from "@/lib/payment-provider";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/mock-pay — 仅供 mock 收银台使用（开发/演示）。
 * 前端不持有渠道密钥，故由服务端：
 *  1. 组装回调 payload；
 *  2. 用 signPayload 生成 HMAC 签名（模拟渠道服务器行为）；
 *  3. 自校验签名后调用 processWebhook（与真实 webhook 同一逻辑 + 幂等）。
 * 生产环境禁用（真实回调来自渠道服务器）。
 * body: { externalOrderId, outcome: "success" | "fail" }
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (process.env.NODE_ENV === "production") return fail("mock 收银台仅限非生产环境", 403);
    assertSameOrigin(req);
    assertRateLimit(req, "mock-pay", 30, 60_000);
    const user = await requireUser();

    const { externalOrderId, outcome } = (await req.json()) as {
      externalOrderId?: string;
      outcome?: "success" | "fail";
    };
    if (!externalOrderId) return fail("缺少订单号");

    // 只允许模拟本人订单，取回渠道
    const order = await prisma.order.findFirst({
      where: { externalOrderId, userId: user.id },
      select: { channel: true, status: true },
    });
    if (!order) throw new AppError("订单不存在");

    if (outcome === "fail") {
      // 失败：不触发 webhook，订单保持 pending
      return ok({ paid: false, message: "模拟支付失败" });
    }

    const channel = order.channel;
    const payload = {
      eventType: "payment.succeeded",
      externalId: externalOrderId, // 幂等键
      externalOrderId,
    };
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(channel, rawBody);

    // 自校验（与真实 webhook 一致的安全边界）
    if (!getProvider(channel).verifyWebhookSignature(rawBody, signature)) {
      throw new AppError("签名生成异常");
    }

    const result = await processWebhook(channel, payload);
    return ok({ paid: true, result });
  });
}
