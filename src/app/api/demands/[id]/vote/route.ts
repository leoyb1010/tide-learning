import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { weekKey, WEEKLY_VOTE_BUDGET, MAX_VOTES_PER_DEMAND } from "@/lib/week";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

// POST /api/demands/:id/vote — 投票（§6.6 规则：仅订阅用户、每周5票、单需求≤3票、投票即时变化）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
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

    // 校验+写入放进同一事务，串行化「读周票额/单需求票额 → 上限校验 → 写入」，
    // 消除并发下的读后写竞态（否则两个并发请求读到同一旧值各自通过校验，突破周额/单需求上限）。
    // SQLite 事务默认串行写；校验失败抛 AppError 触发回滚。
    const result = await prisma.$transaction(async (tx) => {
      // 事务内重新读取本周已用票额与该需求当前票数
      const weekVotes = await tx.demandVote.findMany({ where: { userId: user.id, weekKey: wk } });
      const usedThisWeek = weekVotes.reduce((s, v) => s + v.voteCount, 0);
      const existingForDemand = weekVotes.find((v) => v.demandId === id);
      const existingCount = existingForDemand?.voteCount ?? 0;

      if (existingCount + votes > MAX_VOTES_PER_DEMAND) {
        throw new AppError(`同一需求本周最多投 ${MAX_VOTES_PER_DEMAND} 票`, 400);
      }
      if (usedThisWeek + votes > WEEKLY_VOTE_BUDGET) {
        throw new AppError(`本周剩余 ${WEEKLY_VOTE_BUDGET - usedThisWeek} 票`, 400);
      }

      if (existingForDemand) {
        await tx.demandVote.update({
          where: { id: existingForDemand.id },
          data: { voteCount: existingCount + votes },
        });
      } else {
        await tx.demandVote.create({
          data: { demandId: id, userId: user.id, voteCount: votes, weekKey: wk },
        });
      }

      // 事务内聚合该需求总票数，保证返回值与刚写入的状态一致
      const agg = await tx.demandVote.aggregate({ _sum: { voteCount: true }, where: { demandId: id } });
      return {
        totalVotes: agg._sum.voteCount ?? 0,
        remainingThisWeek: WEEKLY_VOTE_BUDGET - (usedThisWeek + votes),
        myVotesForDemand: existingCount + votes,
      };
    });

    await track({ eventName: "demand_vote", userId: user.id, properties: { demand_id: id, vote_count: votes } });

    return ok(result);
  });
}
