import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, handle } from "@/lib/api";

// POST /api/analytics — 客户端埋点上报（§10 埋点 SDK 包装层）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    const { eventName, properties, anonymousId, platform } = (await req.json()) as {
      eventName: string;
      properties?: Record<string, unknown>;
      anonymousId?: string;
      platform?: string;
    };
    if (!eventName) return ok({ tracked: false });
    await track({ eventName, userId: user?.id, anonymousId, properties, platform });
    return ok({ tracked: true });
  });
}
