import { describe, it, expect, vi } from "vitest";

// demand-score.ts 顶层 import 了 ./db（prisma），只测纯计分函数 demandScore，故 mock 掉。
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { demandScore, assessDemandRisk, type DemandScoreInput } from "@/lib/demand-score";

/**
 * v1.0 计分：score = base + base*0.12*freshness - riskPenalty
 *   base = totalVotes*0.40 + recentVotes*0.28 + paidVotes*0.18 + strategyScore*0.10
 *   freshness = 0.5^(ageDays/21) * 0.5^(daysSinceLastVote/5)  ∈ (0,1]
 */

const FRESHNESS_WEIGHT = 0.12;
const AGE_HALF_LIFE = 21;
const RECENCY_HALF_LIFE = 5;

/** 参考实现（与 lib 保持同一公式），用于断言精确值。 */
function decay(t: number, halfLife: number): number {
  return Math.pow(0.5, Math.max(0, t) / halfLife);
}
function expected(i: DemandScoreInput): number {
  const base = i.totalVotes * 0.4 + i.recentVotes * 0.28 + i.paidVotes * 0.18 + i.strategyScore * 0.1;
  const freshness = decay(i.ageDays, AGE_HALF_LIFE) * decay(i.daysSinceLastVote, RECENCY_HALF_LIFE);
  return base + base * FRESHNESS_WEIGHT * freshness - i.riskPenalty;
}

/** 全零基准（含衰减字段）。 */
const ZERO: DemandScoreInput = {
  totalVotes: 0,
  recentVotes: 0,
  paidVotes: 0,
  strategyScore: 0,
  riskPenalty: 0,
  ageDays: 0,
  daysSinceLastVote: 0,
};

describe("demandScore — 权重（§6.6 v1.0）", () => {
  it("全零输入得 0", () => {
    expect(demandScore(ZERO)).toBe(0);
  });

  it("base 项权重：totalVotes 0.40 / recentVotes 0.28 / paidVotes 0.18 / strategy 0.10", () => {
    // ageDays=daysSinceLastVote=0 → freshness=1，红利 = base*0.12
    expect(demandScore({ ...ZERO, totalVotes: 100 })).toBeCloseTo(expected({ ...ZERO, totalVotes: 100 }));
    expect(demandScore({ ...ZERO, totalVotes: 100 })).toBeCloseTo(40 * (1 + FRESHNESS_WEIGHT));
    expect(demandScore({ ...ZERO, recentVotes: 100 })).toBeCloseTo(28 * (1 + FRESHNESS_WEIGHT));
    expect(demandScore({ ...ZERO, paidVotes: 100 })).toBeCloseTo(18 * (1 + FRESHNESS_WEIGHT));
    expect(demandScore({ ...ZERO, strategyScore: 100 })).toBeCloseTo(10 * (1 + FRESHNESS_WEIGHT));
  });

  it("风险惩罚为线性负项（不受 freshness 影响）", () => {
    expect(demandScore({ ...ZERO, riskPenalty: 20 })).toBeCloseTo(-20);
  });

  it("综合样例与参考实现一致", () => {
    const input: DemandScoreInput = {
      totalVotes: 200,
      recentVotes: 40,
      paidVotes: 150,
      strategyScore: 80,
      riskPenalty: 8,
      ageDays: 10,
      daysSinceLastVote: 3,
    };
    expect(demandScore(input)).toBeCloseTo(expected(input));
  });
});

describe("demandScore — 时间衰减性质", () => {
  const busy: DemandScoreInput = { ...ZERO, totalVotes: 100, ageDays: 0, daysSinceLastVote: 0 };

  it("freshness 上界：新需求红利 = base*0.12（freshness=1）", () => {
    const base = 100 * 0.4;
    expect(demandScore(busy)).toBeCloseTo(base * (1 + FRESHNESS_WEIGHT));
  });

  it("需求越老（ageDays↑）新鲜度红利越低，总分越低", () => {
    const young = demandScore({ ...busy, ageDays: 0 });
    const old = demandScore({ ...busy, ageDays: 60 });
    expect(old).toBeLessThan(young);
  });

  it("距最近投票越久（daysSinceLastVote↑）红利越低", () => {
    const hot = demandScore({ ...busy, daysSinceLastVote: 0 });
    const cold = demandScore({ ...busy, daysSinceLastVote: 30 });
    expect(cold).toBeLessThan(hot);
  });

  it("衰减红利恒为非负，总分不低于纯 base - riskPenalty", () => {
    const i: DemandScoreInput = { ...busy, ageDays: 999, daysSinceLastVote: 999 };
    const base = 100 * 0.4;
    expect(demandScore(i)).toBeGreaterThanOrEqual(base - 1e-6);
  });
});

describe("demandScore — 排序性质", () => {
  it("总票数更多者得分更高（其余相同）", () => {
    const base = { ...ZERO, strategyScore: 50 };
    expect(demandScore({ ...base, totalVotes: 10 })).toBeGreaterThan(
      demandScore({ ...base, totalVotes: 5 }),
    );
  });

  it("高风险惩罚拉低排名", () => {
    const base: DemandScoreInput = { ...ZERO, totalVotes: 100 };
    expect(demandScore({ ...base, riskPenalty: 20 })).toBeLessThan(demandScore(base));
  });
});

describe("assessDemandRisk（P2-3 需求提交风险初评）", () => {
  it("正常需求为 low", () => {
    expect(assessDemandRisk("想学 Excel 数据透视表", "希望有实操案例")).toBe("low");
  });
  it("含 HTML/脚本载荷为 high", () => {
    expect(assessDemandRisk("<img src=x onerror=alert(1)> 想学", undefined)).toBe("high");
    expect(assessDemandRisk("正常标题", "<script>alert(1)</script>")).toBe("high");
  });
  it("外链+导流联系方式组合为 high", () => {
    expect(assessDemandRisk("加我微信领资料", "详情 http://evil.example 加微信 abc")).toBe("high");
  });
  it("单一信号（仅外链 或 仅导流）为 medium", () => {
    expect(assessDemandRisk("参考这个网站", "https://example.com 有教程")).toBe("medium");
    expect(assessDemandRisk("有问题加我微信", "想深入交流")).toBe("medium");
  });
});
