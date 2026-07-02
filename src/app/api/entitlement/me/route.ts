import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, FREE_SNAPSHOT } from "@/lib/entitlement";
import { ok, handle } from "@/lib/api";

// GET /api/entitlement/me — 权益快照（客户端只读，不自行判断，§7.3）
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok(FREE_SNAPSHOT);
    return ok(await resolveEntitlement(user.id));
  });
}
