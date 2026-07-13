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

    const res = await createCheckoutSession("u1", "plan_all", "web_wechat");
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending", channel: "web_wechat" }) }),
    );
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(res.orderId).toBe("order_1");
    expect(res.ticket).toBeDefined();
    // 成功路径不应触发 failed 补偿
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});
