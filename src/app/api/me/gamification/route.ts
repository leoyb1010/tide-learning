import { requireUser } from "@/lib/session";
import { getGamificationSummary } from "@/lib/gamification";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/me/gamification — 当前用户的连续学习 / 潮汐日历 / 成就徽章
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const summary = await getGamificationSummary(user.id);
    return ok(summary);
  });
}
