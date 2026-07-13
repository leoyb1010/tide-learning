import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const db = {
    paymentWebhookLog: {
      create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    order: { findFirst: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    entitlement: { upsert: vi.fn(), updateMany: vi.fn() },
    couponRedemption: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    coupon: { update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  return db;
});

const tail = vi.hoisted(() => ({
  resolveEntitlement: vi.fn().mockResolvedValue({}),
  track: vi.fn().mockResolvedValue(undefined),
  unlockAchievement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/entitlement", () => ({ resolveEntitlement: tail.resolveEntitlement }));
vi.mock("@/lib/analytics", () => ({ track: tail.track }));
vi.mock("@/lib/gamification", () => ({ unlockAchievement: tail.unlockAchievement }));
vi.mock("@/lib/payment-provider", () => ({ getProvider: vi.fn() }));

import { processWebhook } from "@/lib/payment";

const plan = { id: "plan-month", scope: "all", billingPeriod: "month", priceCents: 4990 };
const baseOrder = {
  id: "order-1",
  userId: "user-1",
  planId: plan.id,
  channel: "stripe",
  amountCents: 4990,
  currency: "CNY",
  status: "pending",
  subscriptionId: null,
  couponId: null,
  coupon: null,
  plan,
};

function event(eventType = "payment.succeeded", externalId = "evt-1") {
  return { eventType, externalId, externalOrderId: "stripe-order-1", amountCents: 4990, currency: "CNY" };
}

describe("支付 webhook 事务状态机", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
    prismaMock.paymentWebhookLog.create.mockResolvedValue({ id: "log-1" });
    prismaMock.paymentWebhookLog.findUnique.mockResolvedValue({ id: "log-1", status: "processing" });
    prismaMock.paymentWebhookLog.update.mockResolvedValue({});
    prismaMock.paymentWebhookLog.delete.mockResolvedValue({});
    prismaMock.order.findFirst.mockResolvedValue({ ...baseOrder });
    prismaMock.order.update.mockResolvedValue({});
    prismaMock.subscription.findFirst.mockResolvedValue(null);
    prismaMock.subscription.create.mockResolvedValue({ id: "sub-1" });
    prismaMock.subscription.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    tail.resolveEntitlement.mockResolvedValue({});
    tail.track.mockResolvedValue(undefined);
    tail.unlockAchievement.mockResolvedValue(undefined);
  });

  it("支付成功原子置 paid、绑定订阅，并在提交后刷新权益和完成幂等日志", async () => {
    await expect(processWebhook("stripe", event())).resolves.toMatchObject({
      ok: true, subscriptionId: "sub-1", userId: "user-1",
    });
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" }, data: expect.objectContaining({ status: "paid" }),
    });
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" }, data: { subscriptionId: "sub-1" },
    });
    expect(tail.resolveEntitlement).toHaveBeenCalledWith("user-1");
    expect(prismaMock.paymentWebhookLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" }, data: expect.objectContaining({ status: "processed" }),
    });
  });

  it("相同 externalId 已处理时直接按重复返回，不再次开启订单事务", async () => {
    prismaMock.paymentWebhookLog.create.mockRejectedValue({ code: "P2002" });
    prismaMock.paymentWebhookLog.findUnique.mockResolvedValue({ id: "log-1", status: "processed" });
    await expect(processWebhook("stripe", event())).resolves.toEqual({ ok: true, duplicate: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it("订单已退款后迟到的成功事件不会复活订阅，并留下乱序审计", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ ...baseOrder, status: "refunded" });
    await expect(processWebhook("stripe", event())).resolves.toEqual({ ok: true, duplicate: true });
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "webhook_out_of_order", targetId: "order-1" }),
    });
  });

  it("退款只回退本订单绑定订阅的一个周期，仍有剩余周期时保持 active", async () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 3);
    prismaMock.order.findFirst.mockResolvedValue({ ...baseOrder, status: "paid", subscriptionId: "sub-1" });
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1", status: "active", currentPeriodEnd: future });

    await expect(processWebhook("stripe", event("payment.refunded", "evt-refund"))).resolves.toMatchObject({
      ok: true, refunded: true, userId: "user-1",
    });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { currentPeriodEnd: expect.any(Date) },
    });
    const update = prismaMock.subscription.update.mock.calls[0][0];
    expect(update.data).not.toHaveProperty("status");
  });

  it("错金额拒绝履约并删除未提交的占位日志，使同 externalId 可安全重试", async () => {
    const wrong = { ...event(), amountCents: 1 };
    await expect(processWebhook("stripe", wrong)).rejects.toThrow(/金额/);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    expect(prismaMock.paymentWebhookLog.delete).toHaveBeenCalledWith({ where: { id: "log-1" } });
  });
});
