import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider, signPayload } from "@/lib/payment-provider";

const STRIPE_WEBHOOK_SECRET = "whsec_test_only";

function stripeSignature(body: string, timestamp = Math.floor(Date.now() / 1000), secret = STRIPE_WEBHOOK_SECRET) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.env.PAY_MOCK_SECRET = "test-secret";
  process.env.STRIPE_SECRET_KEY = "sk_test_only";
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "https://learning.example";
});

describe("mock webhook 验签", () => {
  it("同渠道签名通过，篡改、空签名和错误长度均拒绝", () => {
    const body = '{"eventType":"payment.succeeded"}';
    const signature = signPayload("mock", body);
    const provider = getProvider("mock")!;
    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
    expect(provider.verifyWebhookSignature(`${body} `, signature)).toBe(false);
    expect(provider.verifyWebhookSignature(body, null)).toBe(false);
    expect(provider.verifyWebhookSignature(body, "abcd")).toBe(false);
  });

  it("密钥缺失时只返回 false，不降级到默认密钥", () => {
    delete process.env.PAY_MOCK_SECRET;
    expect(getProvider("mock")!.verifyWebhookSignature("body", "a".repeat(64))).toBe(false);
  });
});

describe("Stripe webhook 验签与事件归一化", () => {
  it("按 Stripe t/v1 规则验签，并拒绝篡改、错密钥与超过 5 分钟的重放", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const provider = getProvider("stripe")!;
    expect(provider.verifyWebhookSignature(body, stripeSignature(body))).toBe(true);
    expect(provider.verifyWebhookSignature(`${body} `, stripeSignature(body))).toBe(false);
    expect(provider.verifyWebhookSignature(body, stripeSignature(body, undefined, "wrong"))).toBe(false);
    expect(provider.verifyWebhookSignature(body, stripeSignature(body, Math.floor(Date.now() / 1000) - 301))).toBe(false);
  });

  it("只将已付款 Checkout 归一化为成功事件", () => {
    const paid = JSON.stringify({
      id: "evt_paid",
      type: "checkout.session.completed",
      data: { object: { payment_status: "paid", amount_total: 4990, currency: "cny", client_reference_id: "stripe_order_1", metadata: {} } },
    });
    expect(getProvider("stripe")!.parseWebhook(paid)).toEqual({
      eventType: "payment.succeeded",
      externalId: "evt_paid",
      externalOrderId: "stripe_order_1",
      amountCents: 4990,
      currency: "CNY",
    });
    expect(getProvider("stripe")!.parseWebhook(paid.replace('"paid"', '"unpaid"'))).toBeNull();
  });

  it("只将全额 charge.refunded 归一化为退款事件", () => {
    const refunded = JSON.stringify({
      id: "evt_refund",
      type: "charge.refunded",
      data: { object: { refunded: true, amount_refunded: 4990, currency: "cny", metadata: { external_order_id: "stripe_order_1" } } },
    });
    expect(getProvider("stripe")!.parseWebhook(refunded)).toEqual({
      eventType: "payment.refunded",
      externalId: "evt_refund",
      externalOrderId: "stripe_order_1",
      amountCents: 4990,
      currency: "CNY",
    });
    expect(getProvider("stripe")!.parseWebhook(refunded.replace('"refunded":true', '"refunded":false'))).toBeNull();
  });
});

describe("Stripe Checkout", () => {
  it("创建一次性 Checkout，金额与订单标识由服务端传入", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const ticket = await getProvider("stripe")!.createCheckout({
      orderId: "db_order_1",
      externalOrderId: "stripe_order_1",
      amountCents: 4990,
      currency: "CNY",
      subject: "全站月卡",
      billingPeriod: "month",
    });
    expect(ticket.payUrl).toContain("checkout.stripe.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer sk_test_only",
      "idempotency-key": "tide-db_order_1",
    });
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("4990");
    expect(form.get("line_items[0][price_data][currency]")).toBe("cny");
    expect(form.get("metadata[external_order_id]")).toBe("stripe_order_1");
    expect(form.get("payment_intent_data[metadata][external_order_id]")).toBe("stripe_order_1");
  });

  it("未实现完整订阅生命周期前拒绝自动续费套餐", async () => {
    await expect(getProvider("stripe")!.createCheckout({
      orderId: "o1", externalOrderId: "eo1", amountCents: 990, currency: "CNY", subject: "月卡", billingPeriod: "month_recurring",
    })).rejects.toThrow(/自动续费/);
  });
});

describe("provider 注册边界", () => {
  it("未知、微信和支付宝在未实现时都不伪装成 mock", () => {
    expect(getProvider("nonexistent")).toBeNull();
    expect(getProvider("web_wechat")).toBeNull();
    expect(getProvider("web_alipay")).toBeNull();
  });

  it("生产禁用 mock，但保留真实 Stripe provider", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getProvider("mock")).toBeNull();
    expect(getProvider("stripe")?.channel).toBe("stripe");
  });
});
