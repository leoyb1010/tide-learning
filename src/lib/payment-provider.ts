import { createHmac, timingSafeEqual } from "crypto";

/**
 * D1：支付渠道抽象。mock 为其中一个 provider（开发/演示用），
 * Stripe 已实现原生 Checkout/webhook；微信 Native / 支付宝当面付未实现前不注册 provider。
 * A1-1：所有渠道的 webhook 必须经 verifyWebhookSignature 校验后才处理。
 */

export interface CheckoutParams {
  orderId: string;
  externalOrderId: string;
  amountCents: number;
  currency: string;
  subject: string;
  billingPeriod: string;
  /** 已在服务端校验为站内路径；真实渠道成功后必须回到用户原学习位置。 */
  returnTo: string;
}

export interface CheckoutTicket {
  channel: string;
  externalOrderId: string;
  amountCents: number;
  // mock：收银台可直接调用的确认地址；真实渠道：二维码/跳转链接
  payUrl?: string;
  qrContent?: string;
}

export interface PaymentProvider {
  channel: string;
  signatureHeader: string;
  createCheckout(params: CheckoutParams): Promise<CheckoutTicket>;
  /** 校验 webhook 签名，返回是否可信。 */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): NormalizedPaymentWebhook | null;
}

export interface NormalizedPaymentWebhook {
  eventType: "payment.succeeded" | "payment.refunded";
  externalId: string;
  externalOrderId: string;
  amountCents: number;
  currency: string;
}

/**
 * 每渠道密钥严格从环境变量读取，缺失即抛错 —— 绝不回退到共享/硬编码默认密钥。
 * A1-1：回退到可预测的默认密钥会让攻击者用已知密钥伪造 webhook（0 元开通权益），
 * 因此宁可让漏配的渠道 webhook 直接失败，也不静默降级验签强度。
 */
function secretFor(channel: string): string {
  const key = `PAY_${channel.toUpperCase()}_SECRET`;
  const secret = process.env[key];
  if (!secret) {
    throw new Error(`支付渠道密钥缺失：请配置环境变量 ${key}`);
  }
  return secret;
}

/** HMAC-SHA256 签名（mock / 部分渠道通用）。 */
export function signPayload(channel: string, rawBody: string): string {
  return createHmac("sha256", secretFor(channel)).update(rawBody).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Mock provider：仅供非生产演示业务状态机，不伪装任何真实商户渠道。 */
class MockProvider implements PaymentProvider {
  constructor(public channel: string) {}
  signatureHeader = "x-tide-signature";

  async createCheckout(params: CheckoutParams): Promise<CheckoutTicket> {
    return {
      channel: this.channel,
      externalOrderId: params.externalOrderId,
      amountCents: params.amountCents,
      payUrl: `/checkout/mock?order=${encodeURIComponent(params.externalOrderId)}&next=${encodeURIComponent(params.returnTo)}`,
      qrContent: `tide://pay/${params.externalOrderId}`,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    // 密钥缺失时 signPayload 会抛错：此处兜底为验签失败，绝不放行未签名/错配渠道的请求。
    try {
      return safeEqualHex(signPayload(this.channel, rawBody), signature);
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: string): NormalizedPaymentWebhook | null {
    try {
      const body = JSON.parse(rawBody) as Partial<NormalizedPaymentWebhook>;
      if (
        (body.eventType !== "payment.succeeded" && body.eventType !== "payment.refunded") ||
        !body.externalId || !body.externalOrderId || !Number.isSafeInteger(body.amountCents) ||
        (body.amountCents ?? -1) < 0 || typeof body.currency !== "string"
      ) return null;
      return { ...body, currency: body.currency.toUpperCase() } as NormalizedPaymentWebhook;
    } catch {
      return null;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`支付配置缺失：${name}`);
  return value;
}

class StripeProvider implements PaymentProvider {
  channel = "stripe";
  signatureHeader = "stripe-signature";

  async createCheckout(params: CheckoutParams): Promise<CheckoutTicket> {
    if (params.billingPeriod === "month_recurring") {
      throw new Error("Stripe 自动续费仍需配置 Price/Subscription webhook；请先选择一次性套餐");
    }
    if (!Number.isSafeInteger(params.amountCents) || params.amountCents <= 0) {
      throw new Error("Stripe 订单金额必须为正整数分");
    }
    const secretKey = requiredEnv("STRIPE_SECRET_KEY");
    const site = new URL(requiredEnv("NEXT_PUBLIC_SITE_URL"));
    if (site.protocol !== "https:" && site.hostname !== "localhost" && site.hostname !== "127.0.0.1") {
      throw new Error("NEXT_PUBLIC_SITE_URL 必须为 HTTPS 站点");
    }
    const success = new URL(params.returnTo, site);
    success.searchParams.set("checkout", "success");
    const cancel = new URL("/pricing", site);
    cancel.searchParams.set("checkout", "canceled");
    cancel.searchParams.set("next", params.returnTo);
    const form = new URLSearchParams({
      mode: "payment",
      client_reference_id: params.externalOrderId,
      success_url: success.toString(),
      cancel_url: cancel.toString(),
      "metadata[external_order_id]": params.externalOrderId,
      "payment_intent_data[metadata][external_order_id]": params.externalOrderId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(params.amountCents),
      "line_items[0][price_data][product_data][name]": params.subject.slice(0, 120),
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `tide-${params.orderId}`,
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json().catch(() => ({})) as { id?: string; url?: string };
    if (!response.ok || !json.id || !json.url) throw new Error(`Stripe 创建收银台失败（HTTP ${response.status}）`);
    return { channel: this.channel, externalOrderId: params.externalOrderId, amountCents: params.amountCents, payUrl: json.url };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    if (!signature) return false;
    const parts = signature.split(",").map((x) => x.trim().split("=", 2));
    const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
    const candidates = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || candidates.length === 0) return false;
    try {
      const expected = createHmac("sha256", requiredEnv("STRIPE_WEBHOOK_SECRET")).update(`${timestamp}.${rawBody}`).digest("hex");
      return candidates.some((candidate) => safeEqualHex(expected, candidate));
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: string): NormalizedPaymentWebhook | null {
    try {
      const event = JSON.parse(rawBody) as {
        id?: string; type?: string;
        data?: { object?: { payment_status?: string; refunded?: boolean; amount_total?: number; amount_refunded?: number; currency?: string; client_reference_id?: string; metadata?: Record<string, string> } };
      };
      const object = event.data?.object;
      const externalOrderId = object?.metadata?.external_order_id || object?.client_reference_id;
      if (!event.id || !externalOrderId || !object?.currency) return null;
      if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && object.payment_status === "paid" && Number.isSafeInteger(object.amount_total)) {
        return { eventType: "payment.succeeded", externalId: event.id, externalOrderId, amountCents: object.amount_total!, currency: object.currency.toUpperCase() };
      }
      if (event.type === "charge.refunded" && object.refunded === true && Number.isSafeInteger(object.amount_refunded)) {
        return { eventType: "payment.refunded", externalId: event.id, externalOrderId, amountCents: object.amount_refunded!, currency: object.currency.toUpperCase() };
      }
      return null;
    } catch {
      return null;
    }
  }
}

const MOCK_PROVIDER = new MockProvider("mock");
const STRIPE_PROVIDER = new StripeProvider();

/** 未知渠道返回 null —— webhook route 应据此返回 400，绝不回退到 mock provider。 */
export function getProvider(channel: string): PaymentProvider | null {
  if (channel === "stripe") return STRIPE_PROVIDER;
  if (channel === "mock" && process.env.NODE_ENV !== "production") return MOCK_PROVIDER;
  return null;
}
