import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { weekKey, WEEKLY_VOTE_BUDGET } from "@/lib/week";
import { ok, handle } from "@/lib/api";

// GET /api/demands/me/voted — 我投过的需求 + 本周剩余票额
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ voted: [], remainingThisWeek: 0 });
    const wk = weekKey();
    const votes = await prisma.demandVote.findMany({
      where: { userId: user.id },
      include: { demand: { select: { id: true, title: true, status: true, launchedCourseId: true } } },
    });
    const used = votes.filter((v) => v.weekKey === wk).reduce((s, v) => s + v.voteCount, 0);
    return ok({
      voted: votes.map((v) => ({ ...v.demand, myVotes: v.voteCount, weekKey: v.weekKey })),
      remainingThisWeek: Math.max(0, WEEKLY_VOTE_BUDGET - used),
    });
  });
}
