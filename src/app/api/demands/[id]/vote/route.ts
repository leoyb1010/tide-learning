import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { weekKey, WEEKLY_VOTE_BUDGET, MAX_VOTES_PER_DEMAND } from "@/lib/week";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";

// POST /api/demands/:id/vote — 投票（§6.6 规则：仅订阅用户、每周5票、单需求≤3票、投票即时变化）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const { count } = ((await req.json().catch(() => ({}))) as { count?: number }) ?? {};
    const votes = Math.max(1, Math.min(count ?? 1, MAX_VOTES_PER_DEMAND));

    // 仅订阅用户可投票
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canVote) return fail("仅订阅用户可投票", 402);

    const demand = await prisma.demand.findUnique({ where: { id } });
    if (!demand) return fail("需求不存在", 404);
    if (["rejected", "merged", "launched"].includes(demand.status)) {
      return fail("该需求当前不可投票", 400);
    }

    const wk = weekKey();
    // 本周已用票额
    const weekVotes = await prisma.demandVote.findMany({ where: { userId: user.id, weekKey: wk } });
    const usedThisWeek = weekVotes.reduce((s, v) => s + v.voteCount, 0);
    const existingForDemand = weekVotes.find((v) => v.demandId === id);
    const existingCount = existingForDemand?.voteCount ?? 0;

    if (existingCount + votes > MAX_VOTES_PER_DEMAND) {
      return fail(`同一需求本周最多投 ${MAX_VOTES_PER_DEMAND} 票`, 400);
    }
    if (usedThisWeek + votes > WEEKLY_VOTE_BUDGET) {
      return fail(`本周剩余 ${WEEKLY_VOTE_BUDGET - usedThisWeek} 票`, 400);
    }

    if (existingForDemand) {
      await prisma.demandVote.update({
        where: { id: existingForDemand.id },
        data: { voteCount: existingCount + votes },
      });
    } else {
      await prisma.demandVote.create({
        data: { demandId: id, userId: user.id, voteCount: votes, weekKey: wk },
      });
    }

    await track({ eventName: "demand_vote", userId: user.id, properties: { demand_id: id, vote_count: votes } });

    const all = await prisma.demandVote.findMany({ where: { demandId: id } });
    const totalVotes = all.reduce((s, v) => s + v.voteCount, 0);
    return ok({
      totalVotes,
      remainingThisWeek: WEEKLY_VOTE_BUDGET - (usedThisWeek + votes),
      myVotesForDemand: existingCount + votes,
    });
  });
}
