import { NextRequest } from "next/server";
import { processWebhook } from "@/lib/payment";
import { ok, fail, handle } from "@/lib/api";

// POST /api/webhooks/payment/:channel — 支付回调（幂等，§7.3）
// MVP：同一路由也用于模拟收银台“支付成功/退款”回调。
export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  return handle(async () => {
    const { channel } = await params;
    const body = (await req.json()) as {
      eventType?: string;
      externalId?: string;
      externalOrderId?: string;
    };
    if (!body.externalOrderId) return fail("缺少订单号");
    const result = await processWebhook(channel, {
      eventType: body.eventType ?? "payment.succeeded",
      externalId: body.externalId ?? body.externalOrderId, // 幂等键
      externalOrderId: body.externalOrderId,
    });
    return ok(result);
  });
}
