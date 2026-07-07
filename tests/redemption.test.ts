import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 兑换码体系单测（v3.3）。覆盖：
 *   1) 纯函数：码格式生成/规范化/结构校验（TIDE-XXXX-XXXX-XXXX、去混淆字符）；
 *   2) generateRedemptionCodes 的入参校验（类型/面值/数量/次数/上限）；
 *   3) redeemCode 的各失败态**互相区分**的文案（未知/作废/过期/兑满/本人已兑）+ 成功核销路径。
 *
 * redemption.ts 顶层 import 了 ./db（prisma）、./credits（ensureAccount）、./payment（会员激活）。
 * 只测本模块逻辑，故把这些副作用依赖 mock 掉，用可编排的 prisma stub 驱动分支。
 */

// —— 可编排的 prisma stub（各测试用例按需覆盖返回）——
// 用 vi.hoisted 让 stub 与被 hoist 的 vi.mock 工厂共享同一实例。
const prismaMock = vi.hoisted(() => ({
  plan: { findUnique: vi.fn(), findFirst: vi.fn() },
  redemptionCode: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  redemptionRecord: { findUnique: vi.fn(), create: vi.fn() },
  creditAccount: { update: vi.fn() },
  creditLedger: { create: vi.fn() },
  subscription: { findUniqueOrThrow: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/credits", () => ({ ensureAccount: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/payment", () => ({
  activateMembershipDays: vi.fn().mockResolvedValue("sub_1"),
  resolveGrantPlan: vi.fn().mockResolvedValue({ id: "plan_all", scope: "all", priceCents: 4990, name: "全站月卡" }),
}));

import {
  formatRedemptionCode,
  normalizeRedemptionCode,
  isValidRedemptionCodeFormat,
  generateRedemptionCodes,
  redeemCode,
  REDEMPTION_TYPES,
} from "@/lib/redemption";
import { AppError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
  // 默认：$transaction 执行传入的回调，注入同一 prismaMock 作为 tx。
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
});

// ————————————————————————————————————————————————————————————
//  纯函数：格式 / 规范化 / 校验
// ————————————————————————————————————————————————————————————

describe("formatRedemptionCode —— 分组码生成", () => {
  it("形如 TIDE-XXXX-XXXX-XXXX，且自校验通过", () => {
    for (let i = 0; i < 50; i++) {
      const code = formatRedemptionCode();
      expect(code).toMatch(/^TIDE-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(isValidRedemptionCodeFormat(code)).toBe(true);
    }
  });

  it("不含易混字符 0/O·1/I/L（Crockford 风格字母表）", () => {
    for (let i = 0; i < 100; i++) {
      const body = formatRedemptionCode().replace("TIDE-", "").replace(/-/g, "");
      expect(body).not.toMatch(/[01OIL]/);
    }
  });

  it("大概率不重复（生成 500 个基本无碰撞）", () => {
    const set = new Set<string>();
    for (let i = 0; i < 500; i++) set.add(formatRedemptionCode());
    expect(set.size).toBeGreaterThan(490);
  });
});

describe("normalizeRedemptionCode —— 输入规范化", () => {
  it("去空白 + 转大写", () => {
    expect(normalizeRedemptionCode("  tide-ab23-cd45-ef67 ")).toBe("TIDE-AB23-CD45-EF67");
    expect(normalizeRedemptionCode("tide -ab23 -cd45-ef67")).toBe("TIDE-AB23-CD45-EF67");
  });
});

describe("isValidRedemptionCodeFormat —— 结构校验", () => {
  it("合法码通过", () => {
    expect(isValidRedemptionCodeFormat("TIDE-AB23-CD45-EF67")).toBe(true);
  });
  it("含混淆字符 / 缺组 / 错前缀 / 长度不符 → 拒绝", () => {
    expect(isValidRedemptionCodeFormat("TIDE-AB01-CD45-EF67")).toBe(false); // 含 0/1
    expect(isValidRedemptionCodeFormat("TIDE-AB23-CD45")).toBe(false); // 缺一组
    expect(isValidRedemptionCodeFormat("CODE-AB23-CD45-EF67")).toBe(false); // 错前缀
    expect(isValidRedemptionCodeFormat("TIDE-AB2-CD45-EF67")).toBe(false); // 组长度不符
    expect(isValidRedemptionCodeFormat("")).toBe(false);
  });
});

describe("REDEMPTION_TYPES", () => {
  it("恰好 credits / membership 两类", () => {
    expect([...REDEMPTION_TYPES].sort()).toEqual(["credits", "membership"]);
  });
});

// ————————————————————————————————————————————————————————————
//  generateRedemptionCodes —— 入参校验
// ————————————————————————————————————————————————————————————

describe("generateRedemptionCodes —— 入参校验", () => {
  it("非法类型 / 非正面值 / 非正数量 / 非正次数 → 抛 AppError", async () => {
    // @ts-expect-error 故意传非法类型
    await expect(generateRedemptionCodes({ type: "gift", value: 1, count: 1 })).rejects.toThrow(AppError);
    await expect(generateRedemptionCodes({ type: "credits", value: 0, count: 1 })).rejects.toThrow(/正整数/);
    await expect(generateRedemptionCodes({ type: "credits", value: 10, count: 0 })).rejects.toThrow(/正整数/);
    await expect(generateRedemptionCodes({ type: "credits", value: 10, count: 1, maxUses: 0 })).rejects.toThrow(/正整数/);
    await expect(generateRedemptionCodes({ type: "credits", value: 10, count: 2000 })).rejects.toThrow(/1000/);
  });

  it("membership 指定不存在的 planId → 抛错", async () => {
    prismaMock.plan.findUnique.mockResolvedValue(null);
    await expect(
      generateRedemptionCodes({ type: "membership", value: 30, count: 1, planId: "nope" }),
    ).rejects.toThrow(/套餐/);
  });

  it("合法入参：逐个插入并返回 batchId + 码列表", async () => {
    prismaMock.redemptionCode.create.mockResolvedValue({});
    const res = await generateRedemptionCodes({ type: "credits", value: 100, count: 3 });
    expect(res.codes).toHaveLength(3);
    expect(res.batchId).toMatch(/^batch_/);
    expect(prismaMock.redemptionCode.create).toHaveBeenCalledTimes(3);
    for (const c of res.codes) expect(isValidRedemptionCodeFormat(c)).toBe(true);
  });
});

// ————————————————————————————————————————————————————————————
//  redeemCode —— 各失败态区分 + 成功路径
// ————————————————————————————————————————————————————————————

/** 构造一张 active 的积分码。 */
function creditCode(over: Partial<Record<string, unknown>> = {}) {
  return { id: "rc_1", code: "TIDE-AB23-CD45-EF67", type: "credits", value: 100, planId: null, maxUses: 1, usedCount: 0, status: "active", expiresAt: null, ...over };
}

describe("redeemCode —— 校验失败态各有区分文案", () => {
  it("空 / 格式错 → 早失败", async () => {
    await expect(redeemCode("u1", "")).rejects.toThrow(/输入兑换码/);
    await expect(redeemCode("u1", "not-a-code")).rejects.toThrow(/格式不正确/);
  });

  it("未知码 → 不存在", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(null);
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/不存在/);
  });

  it("已作废码 → 已作废", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode({ status: "disabled" }));
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/作废/);
  });

  it("已过期码 → 已过期", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/过期/);
  });

  it("已兑满（usedCount>=maxUses）→ 已兑完", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode({ usedCount: 1, maxUses: 1 }));
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/兑完/);
  });

  it("本人已兑过 → 已兑换过", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode());
    prismaMock.redemptionRecord.findUnique.mockResolvedValue({ id: "rec_1" });
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/已兑换过/);
  });
});

describe("redeemCode —— 成功核销", () => {
  it("积分码：条件自增命中 → 建记录 → 入账，返回余额", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode({ value: 250 }));
    prismaMock.redemptionRecord.findUnique.mockResolvedValue(null);
    prismaMock.redemptionCode.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.redemptionRecord.create.mockResolvedValue({});
    prismaMock.creditAccount.update.mockResolvedValue({ balance: 350 });
    prismaMock.creditLedger.create.mockResolvedValue({});

    const res = await redeemCode("u1", "TIDE-AB23-CD45-EF67");
    expect(res).toEqual({ type: "credits", value: 250, balance: 350 });
    // 流水类型固定为 redemption
    expect(prismaMock.creditLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "redemption", delta: 250 }) }),
    );
  });

  it("并发下 updateMany count===0（被抢兑）→ 已兑完", async () => {
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode());
    prismaMock.redemptionRecord.findUnique.mockResolvedValue(null);
    prismaMock.redemptionCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(redeemCode("u1", "TIDE-AB23-CD45-EF67")).rejects.toThrow(/兑完/);
  });

  it("会员码：复用 activateMembershipDays，返回会员到期时间", async () => {
    const until = new Date(Date.now() + 30 * 864e5);
    prismaMock.redemptionCode.findUnique.mockResolvedValue(creditCode({ type: "membership", value: 30, planId: null }));
    prismaMock.redemptionRecord.findUnique.mockResolvedValue(null);
    prismaMock.redemptionCode.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.redemptionRecord.create.mockResolvedValue({});
    prismaMock.subscription.findUniqueOrThrow.mockResolvedValue({ currentPeriodEnd: until });

    const res = await redeemCode("u1", "TIDE-AB23-CD45-EF67");
    expect(res.type).toBe("membership");
    expect(res.value).toBe(30);
    expect(res.validUntil).toBe(until.toISOString());
  });
});
