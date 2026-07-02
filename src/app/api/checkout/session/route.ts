import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { createCheckoutSession } from "@/lib/payment";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/checkout/session — 发起支付，返回收银台票据（D1：透传优惠券码）
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    assertRateLimit(req, "checkout", 20, 60_000); // 防刷单
    const user = await requireUser();
    const { planId, channel, couponCode } = (await req.json()) as {
      planId: string;
      channel?: string;
      couponCode?: string;
    };
    if (!planId) return fail("请选择套餐");
    const session = await createCheckoutSession(user.id, planId, channel ?? "mock", couponCode);
    // 前端应跳转 mock 收银台页（ticket.payUrl），由 /api/checkout/mock-pay 在服务端签名后回调 webhook。
    return ok({ ...session, payUrl: session.ticket.payUrl });
  });
}
