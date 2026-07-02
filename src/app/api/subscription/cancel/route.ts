import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { cancelSubscription } from "@/lib/payment";
import { track } from "@/lib/analytics";
import { ok, handle } from "@/lib/api";

// POST /api/subscription/cancel — 取消订阅（权益保留到周期结束，§6.7）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
    await track({ eventName: "subscription_cancel_confirm", userId: user.id, properties: { reason: reason ?? "" } });
    const snapshot = await cancelSubscription(user.id);
    return ok(snapshot);
  });
}
