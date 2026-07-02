import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { ok, handle } from "@/lib/api";

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ user: null, entitlement: null });
    const entitlement = await resolveEntitlement(user.id);
    return ok({
      user: { id: user.id, nickname: user.nickname, email: user.email, phone: user.phone, role: user.role },
      entitlement,
    });
  });
}
