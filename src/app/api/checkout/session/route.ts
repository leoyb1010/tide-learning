import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { createCheckoutSession } from "@/lib/payment";
import { ok, fail, handle } from "@/lib/api";

// POST /api/checkout/session — 发起支付，返回 mock 收银台
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { planId, channel } = (await req.json()) as { planId: string; channel?: string };
    if (!planId) return fail("请选择套餐");
    const session = await createCheckoutSession(user.id, planId, channel ?? "stripe");
    // MVP：返回一个可直接触发 webhook 的确认地址，模拟收银台支付成功
    return ok({ ...session, confirmUrl: `/api/webhooks/payment/${session.channel}` });
  });
}
