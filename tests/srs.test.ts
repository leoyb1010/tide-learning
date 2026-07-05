import { describe, it, expect } from "vitest";
import {
  scheduleNext,
  DAY_MS,
  EASE_DEFAULT,
  EASE_MAX,
  EASE_MIN,
} from "@/lib/srs";

/**
 * SRS（简化 SM-2）调度纯函数单测。
 *
 * 目标：锁死 scheduleNext 的行为，等价于 /api/ai/review-card PATCH 此前的内联实现——
 *   - 记得：ease += 0.1（上限 2.8）；首次 → 1 天，之后 max(1, round(旧间隔 × 新 ease))。
 *   - 忘了：ease -= 0.2（下限 1.3）；间隔重置 1 天。
 *   - dueAt = now + intervalDays 天。
 * 所有用例注入固定 now，避免依赖真实时钟。
 */

// 固定基准时刻，dueAt 断言可精确到毫秒。
const NOW = Date.UTC(2026, 6, 5, 0, 0, 0); // 2026-07-05T00:00:00Z

describe("scheduleNext —— 首次复习", () => {
  it("首次记得（间隔 0）→ 间隔 1 天，ease 升 0.1", () => {
    const r = scheduleNext({ ease: EASE_DEFAULT, intervalDays: 0 }, true, NOW);
    expect(r.intervalDays).toBe(1);
    expect(r.ease).toBeCloseTo(2.6, 10);
    expect(r.dueAt.getTime()).toBe(NOW + 1 * DAY_MS);
  });

  it("首次忘了（间隔 0）→ 间隔 1 天，ease 降 0.2", () => {
    const r = scheduleNext({ ease: EASE_DEFAULT, intervalDays: 0 }, false, NOW);
    expect(r.intervalDays).toBe(1);
    expect(r.ease).toBeCloseTo(2.3, 10);
    expect(r.dueAt.getTime()).toBe(NOW + 1 * DAY_MS);
  });

  it("ease 缺省（null/undefined）按 2.5 起算", () => {
    const rNull = scheduleNext({ ease: null, intervalDays: 0 }, true, NOW);
    expect(rNull.ease).toBeCloseTo(2.6, 10);
    const rUndef = scheduleNext({ intervalDays: 0 }, true, NOW);
    expect(rUndef.ease).toBeCloseTo(2.6, 10);
  });
});

describe("scheduleNext —— 记得（已有间隔）", () => {
  it("间隔翻倍并乘以更新后的 ease，四舍五入", () => {
    // ease 2.5 → 2.6；间隔 4 × 2.6 = 10.4 → round 10
    const r = scheduleNext({ ease: 2.5, intervalDays: 4 }, true, NOW);
    expect(r.ease).toBeCloseTo(2.6, 10);
    expect(r.intervalDays).toBe(10);
    expect(r.dueAt.getTime()).toBe(NOW + 10 * DAY_MS);
  });

  it("四舍五入向上取整示例（round，非 floor）", () => {
    // ease 1.7 → 1.8；间隔 3 × 1.8 = 5.4 → round 5
    expect(scheduleNext({ ease: 1.7, intervalDays: 3 }, true, NOW).intervalDays).toBe(5);
    // ease 1.9 → 2.0；间隔 3 × 2.0 = 6 → 6
    expect(scheduleNext({ ease: 1.9, intervalDays: 3 }, true, NOW).intervalDays).toBe(6);
  });

  it("间隔至少为 1（下限保护）", () => {
    // 极端：间隔 1 × ease 1.4（1.3+0.1）= 1.4 → round 1
    const r = scheduleNext({ ease: 1.3, intervalDays: 1 }, true, NOW);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
    expect(r.intervalDays).toBe(1);
  });
});

describe("scheduleNext —— ease 上下限", () => {
  it("记得时 ease 封顶 2.8（不超过上限）", () => {
    // 2.8 + 0.1 = 2.9 → 封顶 2.8
    const r = scheduleNext({ ease: EASE_MAX, intervalDays: 5 }, true, NOW);
    expect(r.ease).toBe(EASE_MAX);
    // 间隔 5 × 2.8 = 14
    expect(r.intervalDays).toBe(14);
  });

  it("接近上限时抬到但不越过 2.8", () => {
    // 2.75 + 0.1 = 2.85 → 封顶 2.8
    const r = scheduleNext({ ease: 2.75, intervalDays: 2 }, true, NOW);
    expect(r.ease).toBe(EASE_MAX);
  });

  it("忘了时 ease 触底 1.3（不低于下限）", () => {
    // 1.3 - 0.2 = 1.1 → 触底 1.3
    const r = scheduleNext({ ease: EASE_MIN, intervalDays: 20 }, false, NOW);
    expect(r.ease).toBe(EASE_MIN);
    expect(r.intervalDays).toBe(1);
  });

  it("接近下限时压到但不越过 1.3", () => {
    // 1.4 - 0.2 = 1.2 → 触底 1.3
    const r = scheduleNext({ ease: 1.4, intervalDays: 20 }, false, NOW);
    expect(r.ease).toBe(EASE_MIN);
  });
});

describe("scheduleNext —— 忘了总是重置间隔", () => {
  it("无论旧间隔多大，忘了都归 1 天", () => {
    for (const interval of [0, 1, 7, 30, 365]) {
      const r = scheduleNext({ ease: 2.5, intervalDays: interval }, false, NOW);
      expect(r.intervalDays).toBe(1);
      expect(r.dueAt.getTime()).toBe(NOW + 1 * DAY_MS);
    }
  });
});

describe("scheduleNext —— 纯函数性（不依赖真实时钟）", () => {
  it("相同入参与 now 产出完全一致（可确定复现）", () => {
    const a = scheduleNext({ ease: 2.5, intervalDays: 4 }, true, NOW);
    const b = scheduleNext({ ease: 2.5, intervalDays: 4 }, true, NOW);
    expect(a).toEqual(b);
  });

  it("不修改入参对象", () => {
    const card = { ease: 2.5, intervalDays: 4 };
    scheduleNext(card, true, NOW);
    expect(card).toEqual({ ease: 2.5, intervalDays: 4 });
  });
});
