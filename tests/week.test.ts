import { describe, it, expect } from "vitest";
import {
  weekKey,
  shanghaiDayKey,
  msUntilWeekReset,
  WEEKLY_VOTE_BUDGET,
  MAX_VOTES_PER_DEMAND,
} from "@/lib/week";

/**
 * 周界与潮汐日历的时区正确性测试。
 * 关键：所有判定以 Asia/Shanghai（UTC+8，无夏令时）为准，
 * “每周一 00:00 北京时间重置”必须与用户直觉一致。
 */

describe("shanghaiDayKey", () => {
  it("把 UTC 16:00 归入上海次日（+8 越过零点）", () => {
    // 2026-01-01 16:00 UTC == 2026-01-02 00:00 上海
    expect(shanghaiDayKey(new Date("2026-01-01T16:00:00Z"))).toBe("2026-01-02");
  });

  it("UTC 15:59 仍属上海当日", () => {
    // 2026-01-01 15:59 UTC == 2026-01-01 23:59 上海
    expect(shanghaiDayKey(new Date("2026-01-01T15:59:00Z"))).toBe("2026-01-01");
  });

  it("跨年边界正确进位", () => {
    // 2025-12-31 16:00 UTC == 2026-01-01 00:00 上海
    expect(shanghaiDayKey(new Date("2025-12-31T16:00:00Z"))).toBe("2026-01-01");
  });

  it("补零到 YYYY-MM-DD", () => {
    expect(shanghaiDayKey(new Date("2026-03-05T04:00:00Z"))).toBe("2026-03-05");
  });
});

describe("weekKey", () => {
  it("北京时间周一凌晨归入本周（新周），而非上周", () => {
    // 2026-01-05 是周一。上海周一 00:00 == 2026-01-04 16:00 UTC。
    const mondayStartUtc = new Date("2026-01-04T16:00:00Z"); // 上海 周一 00:00
    const sundayEndUtc = new Date("2026-01-04T15:59:00Z"); // 上海 周日 23:59（上一周）
    const mk = weekKey(mondayStartUtc);
    const sk = weekKey(sundayEndUtc);
    expect(mk).not.toBe(sk); // 跨周界，key 必须不同
    expect(mk).toBe("2026-W02");
    expect(sk).toBe("2026-W01");
  });

  it("同一上海自然周内的不同日返回同一 key", () => {
    // 2026-01-05(一) 到 2026-01-11(日) 属同一 ISO 周 W02
    const mon = weekKey(new Date("2026-01-05T02:00:00Z")); // 上海 周一 10:00
    const sun = weekKey(new Date("2026-01-11T02:00:00Z")); // 上海 周日 10:00
    expect(mon).toBe("2026-W02");
    expect(sun).toBe("2026-W02");
  });

  it("格式为 YYYY-Www（周补零两位）", () => {
    expect(weekKey(new Date("2026-01-05T02:00:00Z"))).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe("msUntilWeekReset", () => {
  it("上海周一 00:00 起点：距下次重置为整 7 天", () => {
    const mondayStartUtc = new Date("2026-01-04T16:00:00Z"); // 上海 周一 00:00
    expect(msUntilWeekReset(mondayStartUtc)).toBe(7 * 24 * 3600 * 1000);
  });

  it("上海周日 23:59 时仅剩 1 分钟", () => {
    const sundayEndUtc = new Date("2026-01-04T15:59:00Z"); // 上海 周日 23:59
    expect(msUntilWeekReset(sundayEndUtc)).toBe(60 * 1000);
  });

  it("永不返回负值", () => {
    expect(msUntilWeekReset(new Date("2026-06-15T08:00:00Z"))).toBeGreaterThanOrEqual(0);
  });

  it("结果始终 ≤ 7 天", () => {
    const week = 7 * 24 * 3600 * 1000;
    for (const iso of ["2026-01-04T16:00:00Z", "2026-02-10T03:00:00Z", "2026-12-31T23:00:00Z"]) {
      expect(msUntilWeekReset(new Date(iso))).toBeLessThanOrEqual(week);
    }
  });
});

describe("常量", () => {
  it("每周投票预算与单需求上限符合 §6.6", () => {
    expect(WEEKLY_VOTE_BUDGET).toBe(5);
    expect(MAX_VOTES_PER_DEMAND).toBe(3);
  });
});
