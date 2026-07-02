import { prisma } from "./db";
import { weekKey } from "./week";

/**
 * 需求排行榜综合分 — 计划书 v0.3 §6.6。
 *   score = 总票数*0.45 + 近7天新增*0.25 + 付费用户票*0.20 + 战略匹配*0.10 - 风险惩罚
 */
export interface DemandScoreInput {
  totalVotes: number;
  recentVotes: number;   // 近 7 天
  paidVotes: number;     // 付费用户投票
  strategyScore: number; // 0–100 内容战略匹配
  riskPenalty: number;   // 合规/制作风险惩罚
}

export function demandScore(i: DemandScoreInput): number {
  return (
    i.totalVotes * 0.45 +
    i.recentVotes * 0.25 +
    i.paidVotes * 0.2 +
    i.strategyScore * 0.1 -
    i.riskPenalty
  );
}

const STATUS_STRATEGY: Record<string, number> = {
  scheduled: 80,
  producing: 90,
  evaluating: 60,
  collecting: 40,
  launched: 100,
};
const RISK_PENALTY: Record<string, number> = { low: 0, medium: 8, high: 20 };

/** 为需求列表计算票数与排序分。 */
export async function rankDemands(statuses?: string[]) {
  const demands = await prisma.demand.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    include: {
      votes: { include: { user: true } },
      _count: { select: { votes: true } },
    },
  });

  const currentWeek = weekKey();
  const scored = demands.map((d) => {
    const totalVotes = d.votes.reduce((s, v) => s + v.voteCount, 0);
    const recentVotes = d.votes
      .filter((v) => v.weekKey === currentWeek)
      .reduce((s, v) => s + v.voteCount, 0);
    const paidVotes = totalVotes; // MVP：投票已限订阅用户，全部计为付费票
    const score = demandScore({
      totalVotes,
      recentVotes,
      paidVotes,
      strategyScore: STATUS_STRATEGY[d.status] ?? 30,
      riskPenalty: RISK_PENALTY[d.riskLevel] ?? 0,
    });
    return { ...d, totalVotes, recentVotes, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}
