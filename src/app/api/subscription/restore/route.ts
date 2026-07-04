import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { restorePurchase } from "@/lib/payment";
import { ok, handle, assertSameOrigin } from "@/lib/api";

// POST /api/subscription/restore — 恢复购买（跨端登录，§7.3）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    assertSameOrigin(req);
    return ok(await restorePurchase(user.id));
  });
}
