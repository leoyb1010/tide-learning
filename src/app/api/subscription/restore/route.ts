import { requireUser } from "@/lib/session";
import { restorePurchase } from "@/lib/payment";
import { ok, handle } from "@/lib/api";

// POST /api/subscription/restore — 恢复购买（跨端登录，§7.3）
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    return ok(await restorePurchase(user.id));
  });
}
