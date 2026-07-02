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

/** 每渠道密钥从环境变量读取，缺失时用开发默认（生产必须覆盖）。 */
function secretFor(channel: string): string {
  const key = `PAY_${channel.toUpperCase()}_SECRET`;
  return process.env[key] ?? process.env.PAY_MOCK_SECRET ?? "dev-mock-secret";
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
    return safeEqualHex(signPayload(this.channel, rawBody), signature);
  }
}

const PROVIDERS: Record<string, PaymentProvider> = {
  mock: new MockProvider("mock"),
  web_wechat: new MockProvider("web_wechat"),
  web_alipay: new MockProvider("web_alipay"),
  stripe: new MockProvider("stripe"),
};

export function getProvider(channel: string): PaymentProvider {
  return PROVIDERS[channel] ?? PROVIDERS.mock;
}
