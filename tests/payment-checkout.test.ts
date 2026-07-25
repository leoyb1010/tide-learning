import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createCheckoutSession —— provider 先校验、绝不落孤儿 pending（P0-2 回归）。
 *
 * 审计发现：不支持渠道 / 生产禁用 mock 时，checkout 会先创建 pending 订单再抛 400，
 * 在订单列表/财务对账留下用户从未进入收银台的脏数据。修复为「先校验 provider 再落单」，
 * 且真实渠道 createCheckout 抛错时把订单标 failed（不留 pending）。
 *
 * payment.ts 顶层 import 了 db / payment-provider / analytics / entitlement / gamification，
 * 只测 createCheckoutSession 分支，故 mock 掉带副作用的依赖，用 prisma stub 断言「是否落单」。
 */

const prismaMock = vi.hoisted(() => {
  const base = {
    plan: { findUnique: vi.fn() },
    order: { count: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    coupon: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    couponRedemption: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    // P2-1：订单创建 + 优惠券预留在 $transaction 内完成；测试里直接以 mock 自身作 tx 执行回调。
    $transaction: vi.fn(),
  };
  base.$transaction.mockImplementation(async (fn: (tx: typeof base) => unknown) => fn(base));
  return base;
});
const providerMock = vi.hoisted(() => ({ getProvider: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/payment-provider", () => ({ getProvider: providerMock.getProvider }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));

import { createCheckoutSession } from "@/lib/payment";

const PLAN = {
  id: "plan_all",
  isActive: true,
  priceCents: 4990,
  firstPriceCents: null,
  currency: "CNY",
  name: "全站月卡",
  scope: "all",
  billingPeriod: "month",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.plan.findUnique.mockResolvedValue(PLAN);
  prismaMock.order.count.mockResolvedValue(0);
});

describe("createCheckoutSession —— provider 先校验", () => {
  it("不支持渠道：抛「不支持的支付渠道」且不创建订单", async () => {
    providerMock.getProvider.mockReturnValue(null);
    await expect(createCheckoutSession("u1", "plan_all", "bogus_channel")).rejects.toThrow(/不支持的支付渠道/);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("mock 生产禁用（getProvider 返回 null）：抛错且不创建订单", async () => {
    providerMock.getProvider.mockReturnValue(null);
    await expect(createCheckoutSession("u1", "plan_all", "mock")).rejects.toThrow(/不支持的支付渠道/);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("真实渠道 createCheckout 抛错：订单被标记 failed（补偿，不留 pending）", async () => {
    providerMock.getProvider.mockReturnValue({
      channel: "web_wechat",
      createCheckout: vi.fn().mockRejectedValue(new Error("gateway down")),
      verifyWebhookSignature: () => false,
    });
    prismaMock.order.create.mockResolvedValue({ id: "order_1" });
    prismaMock.order.update.mockResolvedValue({});

    await expect(createCheckoutSession("u1", "plan_all", "web_wechat")).rejects.toThrow(/gateway down/);
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("正常渠道：创建 pending 订单（status=pending）并返回票据", async () => {
    const createCheckout = vi
      .fn()
      .mockResolvedValue({ channel: "web_wechat", externalOrderId: "web_wechat_x", amountCents: 4990, payUrl: "/pay" });
    providerMock.getProvider.mockReturnValue({
      channel: "web_wechat",
      createCheckout,
      verifyWebhookSignature: () => true,
    });
    prismaMock.order.create.mockResolvedValue({ id: "order_1" });

    const res = await createCheckoutSession("u1", "plan_all", "web_wechat", undefined, "//evil.example");
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending", channel: "web_wechat" }) }),
    );
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/me/subscription" }));
    expect(res.orderId).toBe("order_1");
    expect(res.ticket).toBeDefined();
    // 成功路径不应触发 failed 补偿
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});

describe("优惠券名额搬移 —— 旧 pending 打折单必须作废(资金审查 B-1 回归)", () => {
  const COUPON = { id: "cp1", code: "SAVE", kind: "percent", value: 100, maxRedeem: 100, redeemedCount: 1, isActive: true, expiresAt: null, planScope: "any" };

  it("已有指向旧 pending 单的核销行:名额搬到新单,且旧单被置 failed 并剥离折扣", async () => {
    providerMock.getProvider.mockReturnValue({
      channel: "mock",
      createCheckout: vi.fn().mockResolvedValue({ ticket: { kind: "mock", payUrl: "/x" } }),
      verifyWebhookSignature: () => true,
    });
    prismaMock.coupon.findUnique.mockResolvedValue(COUPON);
    prismaMock.order.create.mockResolvedValue({ id: "order_new" });
    // 该用户已对此券占过名额,持有单是 order_old 且仍 pending(用户下单不付、反复下单的场景)
    prismaMock.couponRedemption.findUnique.mockResolvedValue({ id: "red1", orderId: "order_old" });
    prismaMock.order.findUnique.mockResolvedValue({ status: "pending" });
    prismaMock.order.update.mockResolvedValue({});
    prismaMock.couponRedemption.update.mockResolvedValue({});

    await createCheckoutSession("u1", "plan_all", "mock", "SAVE");

    // 关键断言:旧 pending 单被作废且折扣被剥离——否则可攒出 N 张打折单逐一支付,
    // 回调走 alreadyRedeemed 分支跳过校验,同券完成 N 笔折扣订单(100% 券=无限免费订阅)。
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_old" },
        data: expect.objectContaining({ status: "failed", couponId: null, discountCents: 0 }),
      }),
    );
    // 名额确实搬到新单
    expect(prismaMock.couponRedemption.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "red1" }, data: { orderId: "order_new" } }),
    );
  });

  it("持有单已 paid:直接拒绝,不搬名额也不作废任何单", async () => {
    providerMock.getProvider.mockReturnValue({
      channel: "mock",
      createCheckout: vi.fn(),
      verifyWebhookSignature: () => true,
    });
    prismaMock.coupon.findUnique.mockResolvedValue(COUPON);
    prismaMock.order.create.mockResolvedValue({ id: "order_new" });
    prismaMock.couponRedemption.findUnique.mockResolvedValue({ id: "red1", orderId: "order_paid" });
    prismaMock.order.findUnique.mockResolvedValue({ status: "paid" });

    await expect(createCheckoutSession("u1", "plan_all", "mock", "SAVE")).rejects.toThrow(/每人限用一次/);
    expect(prismaMock.couponRedemption.update).not.toHaveBeenCalled();
  });
});
