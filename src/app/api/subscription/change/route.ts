import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { changeSubscriptionPlan } from "@/lib/payment";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/subscription/change — 订阅升/降级（D1）
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    assertRateLimit(req, "sub-change", 10, 60_000);
    const user = await requireUser();
    const { planId } = (await req.json()) as { planId?: string };
    if (!planId) return fail("请选择目标套餐");
    // changeSubscriptionPlan 内部已埋 subscription_change；这里补充触发上下文
    const snapshot = await changeSubscriptionPlan(user.id, planId);
    await track({ eventName: "subscription_change", userId: user.id, properties: { to_plan: planId, source: "self_service" } });
    return ok(snapshot);
  });
}
