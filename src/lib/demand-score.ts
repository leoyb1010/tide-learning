import { prisma } from "./db";
import { weekKey } from "./week";

/**
 * 需求排行榜综合分 — 计划书 v1.0 §6.6（升级：引入时间衰减因子）。
 *
 *   score = 总票数*0.40 + 近7天新增*0.28 + 付费票*0.18 + 战略匹配*0.10
 *           + 时间衰减红利 - 风险惩罚
 *
 * 时间衰减思路：
 *   - 近期投票权重更高（recentVotes 已单独加权，且随「最近一次投票距今天数」赋予新鲜度红利）；
 *   - 老需求随「距创建天数」缓慢衰减，避免长期霸榜、给新潮腾出水面。
 * 两者相乘得到 freshness ∈ (0,1]，再乘以基础分的一部分作为红利项。
 */
export interface DemandScoreInput {
  totalVotes: number;
  recentVotes: number;      // 近 7 天（本周）
  paidVotes: number;        // 付费用户投票
  strategyScore: number;    // 0–100 内容战略匹配
  riskPenalty: number;      // 合规/制作风险惩罚
  ageDays: number;          // 距创建天数
  daysSinceLastVote: number; // 距最近一次投票天数（无票时取 ageDays）
}

// 衰减半衰期（天）：需求年龄越大、最近投票越久，新鲜度越低。
const AGE_HALF_LIFE = 21;         // 老需求：约三周半衰
const RECENCY_HALF_LIFE = 5;      // 投票热度：约五天半衰
const FRESHNESS_WEIGHT = 0.12;    // 新鲜度红利在总分中的占比系数

/** 指数衰减：t 越大越接近 0，半衰期为 halfLife。 */
function decay(t: number, halfLife: number): number {
  return Math.pow(0.5, Math.max(0, t) / halfLife);
}

export function demandScore(i: DemandScoreInput): number {
  const base =
    i.totalVotes * 0.4 +
    i.recentVotes * 0.28 +
    i.paidVotes * 0.18 +
    i.strategyScore * 0.1;

  // 新鲜度 ∈ (0,1]：既看需求年龄，也看最近投票的新近程度。
  const freshness =
    decay(i.ageDays, AGE_HALF_LIFE) * decay(i.daysSinceLastVote, RECENCY_HALF_LIFE);

  return base + base * FRESHNESS_WEIGHT * freshness - i.riskPenalty;
}

const STATUS_STRATEGY: Record<string, number> = {
  scheduled: 80,
  producing: 90,
  evaluating: 60,
  collecting: 40,
  launched: 100,
};
const RISK_PENALTY: Record<string, number> = { low: 0, medium: 8, high: 20 };

const DAY_MS = 86400000;

/**
 * 为需求列表计算票数与排序分。
 * 性能：不再 include votes.user（消除 N+1），仅按 demandId 聚合计票 + 取最近投票时间。
 * 返回结构保留 totalVotes / recentVotes / score 等既有字段，向后兼容。
 */
export async function rankDemands(statuses?: string[]) {
  const demands = await prisma.demand.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
  });
  if (demands.length === 0) return [];

  const demandIds = demands.map((d) => d.id);
  const currentWeek = weekKey();

  // 聚合总票数（按需求分组）。
  const totalAgg = await prisma.demandVote.groupBy({
    by: ["demandId"],
    where: { demandId: { in: demandIds } },
    _sum: { voteCount: true },
    _max: { createdAt: true },
  });
  // 聚合本周票数（近 7 天口径以「当前周」近似）。
  const weekAgg = await prisma.demandVote.groupBy({
    by: ["demandId"],
    where: { demandId: { in: demandIds }, weekKey: currentWeek },
    _sum: { voteCount: true },
  });

  const totalMap = new Map(
    totalAgg.map((r) => [r.demandId, { sum: r._sum.voteCount ?? 0, last: r._max.createdAt }]),
  );
  const weekMap = new Map(weekAgg.map((r) => [r.demandId, r._sum.voteCount ?? 0]));

  const now = Date.now();
  const scored = demands.map((d) => {
    const agg = totalMap.get(d.id);
    const totalVotes = agg?.sum ?? 0;
    const recentVotes = weekMap.get(d.id) ?? 0;
    const ageDays = (now - d.createdAt.getTime()) / DAY_MS;
    const daysSinceLastVote = agg?.last
      ? (now - agg.last.getTime()) / DAY_MS
      : ageDays;
    const paidVotes = totalVotes; // MVP：投票已限订阅用户，全部计为付费票

    const score = demandScore({
      totalVotes,
      recentVotes,
      paidVotes,
      strategyScore: STATUS_STRATEGY[d.status] ?? 30,
      riskPenalty: RISK_PENALTY[d.riskLevel] ?? 0,
      ageDays,
      daysSinceLastVote,
    });
    return { ...d, totalVotes, recentVotes, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}
