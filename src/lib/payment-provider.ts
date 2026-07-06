import { createHmac, timingSafeEqual } from "crypto";

/**
 * D1：支付渠道抽象。mock 为其中一个 provider（开发/演示用），
 * 真实微信 Native / 支付宝当面付 / Stripe 只需实现同一接口挂上。
 * A1-1：所有渠道的 webhook 必须经 verifyWebhookSignature 校验后才处理。
 */

export interface CheckoutParams {
  orderId: string;
  externalOrderId: string;
  amountCents: number;
  currency: string;
  subject: string;
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
  createCheckout(params: CheckoutParams): Promise<CheckoutTicket>;
  /** 校验 webhook 签名，返回是否可信。 */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
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

/** Mock provider：模拟微信/支付宝/Stripe，签名机制与真实渠道等价（HMAC）。 */
class MockProvider implements PaymentProvider {
  constructor(public channel: string) {}

  async createCheckout(params: CheckoutParams): Promise<CheckoutTicket> {
    return {
      channel: this.channel,
      externalOrderId: params.externalOrderId,
      amountCents: params.amountCents,
      payUrl: `/checkout/mock?order=${encodeURIComponent(params.externalOrderId)}`,
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
}

const PROVIDERS: Record<string, PaymentProvider> = {
  mock: new MockProvider("mock"),
  web_wechat: new MockProvider("web_wechat"),
  web_alipay: new MockProvider("web_alipay"),
  stripe: new MockProvider("stripe"),
};

/** 未知渠道返回 null —— webhook route 应据此返回 400，绝不回退到 mock provider。 */
export function getProvider(channel: string): PaymentProvider | null {
  // P0：mock 渠道生产门禁——生产默认不可用，仅当显式置 MOCK_PAY_ENABLED=1 时放行
  // （与 mock-pay / recharge 路由同一闸门），防止生产环境经 mock 渠道伪造支付。
  if (channel === "mock" && process.env.NODE_ENV === "production" && process.env.MOCK_PAY_ENABLED !== "1") {
    return null;
  }
  return PROVIDERS[channel] ?? null;
}
