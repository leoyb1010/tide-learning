import { describe, it, expect } from "vitest";
import { scheduleFsrs, Grade, isGrade, rememberedToGrade, DAY_MS } from "@/lib/srs";

/**
 * SRS（FSRS-6）调度单测。
 * 旧「简化 SM-2」已于 2026-07-19 换代删除（无生产回退路径），其测试段随之移除（git 历史可查）。
 * 所有用例注入固定 now，避免依赖真实时钟。
 */

const NOW = Date.UTC(2026, 6, 19, 0, 0, 0);

describe("isGrade —— 评分校验", () => {
  it("只接受 1/2/3/4", () => {
    for (const g of [1, 2, 3, 4]) expect(isGrade(g)).toBe(true);
    for (const g of [0, 5, -1, 3.5, "3", null, undefined, NaN]) expect(isGrade(g)).toBe(false);
  });
});

describe("rememberedToGrade —— 两键兼容映射", () => {
  it("记得→Good(3)，忘了→Again(1)", () => {
    expect(rememberedToGrade(true)).toBe(Grade.Good);
    expect(rememberedToGrade(false)).toBe(Grade.Again);
  });
});

describe("scheduleFsrs —— 新卡冷启动（存量卡 stability/difficulty 为空）", () => {
  const newCard = { dueAt: new Date(NOW), stability: null, difficulty: null, state: 0 };

  it("Good → 进入学习态，产出正的 stability/difficulty", () => {
    const r = scheduleFsrs(newCard, Grade.Good, NOW);
    expect(r.state).toBe(1); // Learning
    expect(r.stability).toBeGreaterThan(0);
    expect(r.difficulty).toBeGreaterThan(0);
    expect(r.reps).toBe(1);
    expect(r.dueAt.getTime()).toBeGreaterThanOrEqual(NOW);
    expect(r.lastReview.getTime()).toBe(NOW);
  });

  it("Easy → 直接跳到复习态，间隔明显更长", () => {
    const good = scheduleFsrs(newCard, Grade.Good, NOW);
    const easy = scheduleFsrs(newCard, Grade.Easy, NOW);
    expect(easy.state).toBe(2); // Review
    expect(easy.scheduledDays).toBeGreaterThan(good.scheduledDays);
  });

  it("四档区分度：Again ≤ Hard ≤ Good ≤ Easy 的稳定度单调不减", () => {
    const s = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy].map(
      (g) => scheduleFsrs(newCard, g, NOW).stability,
    );
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
  });
});

describe("scheduleFsrs —— 成熟卡（复习态）", () => {
  const mature = {
    dueAt: new Date(NOW),
    stability: 15,
    difficulty: 5,
    state: 2,
    reps: 5,
    lapses: 1,
    elapsedDays: 15,
    scheduledDays: 15,
    learningSteps: 0,
    lastReview: new Date(NOW - 15 * DAY_MS),
  };

  it("Good → 间隔在旧间隔基础上增长（FSRS 相比 SM-2 的核心优势）", () => {
    const r = scheduleFsrs(mature, Grade.Good, NOW);
    expect(r.scheduledDays).toBeGreaterThan(15);
    expect(r.state).toBe(2);
    expect(r.reps).toBe(6);
  });

  it("Again → 记一次遗忘（lapses+1）并转再学习态", () => {
    const r = scheduleFsrs(mature, Grade.Again, NOW);
    expect(r.lapses).toBe(2);
    expect(r.state).toBe(3); // Relearning
  });

  it("纯函数：同输入同 now 完全可复现", () => {
    const a = scheduleFsrs(mature, Grade.Good, NOW);
    const b = scheduleFsrs(mature, Grade.Good, NOW);
    expect(a).toEqual(b);
  });

  it("调度产物的整数列恒为整数（Prisma Int 列安全）", () => {
    for (const g of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
      const r = scheduleFsrs(mature, g, NOW);
      for (const v of [r.state, r.reps, r.lapses, r.elapsedDays, r.scheduledDays, r.learningSteps, r.intervalDays]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});
