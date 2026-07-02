import { describe, it, expect, beforeAll } from "vitest";
import { getProvider, signPayload } from "@/lib/payment-provider";

/**
 * 支付渠道签名往返测试：
 *  - signPayload + verifyWebhookSignature 往返一致；
 *  - 错误/缺失签名被拒；
 *  - 校验走 timingSafeEqual（等长比较），长度不同直接拒绝。
 */

beforeAll(() => {
  // 固定密钥，保证签名可复现（不依赖机器环境变量）。
  process.env.PAY_MOCK_SECRET = "test-secret";
  process.env.PAY_STRIPE_SECRET = "stripe-secret";
});

describe("signPayload / verifyWebhookSignature 往返", () => {
  it("同渠道签名可通过校验", () => {
    const body = '{"orderId":"o1","status":"paid"}';
    const sig = signPayload("mock", body);
    expect(getProvider("mock")!.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("不同渠道使用各自密钥（stripe 密钥独立）", () => {
    const body = "payload";
    const sig = signPayload("stripe", body);
    expect(getProvider("stripe")!.verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("篡改 body 后签名失配被拒", () => {
    const sig = signPayload("mock", "original");
    expect(getProvider("mock")!.verifyWebhookSignature("tampered", sig)).toBe(false);
  });

  it("错误签名被拒（等长十六进制但内容不同）", () => {
    const good = signPayload("mock", "body");
    // 翻转首字符，保持长度一致以触发 timingSafeEqual 而非长度短路
    const flipped = (good[0] === "0" ? "1" : "0") + good.slice(1);
    expect(getProvider("mock")!.verifyWebhookSignature("body", flipped)).toBe(false);
  });

  it("空签名被拒", () => {
    expect(getProvider("mock")!.verifyWebhookSignature("body", null)).toBe(false);
    expect(getProvider("mock")!.verifyWebhookSignature("body", "")).toBe(false);
  });

  it("长度不等的签名被拒（不抛异常）", () => {
    expect(getProvider("mock")!.verifyWebhookSignature("body", "abcd")).toBe(false);
  });

  it("跨渠道签名不通用（stripe 签名不能过 mock 校验）", () => {
    const body = "cross";
    const stripeSig = signPayload("stripe", body);
    expect(getProvider("mock")!.verifyWebhookSignature(body, stripeSig)).toBe(false);
  });
});

describe("getProvider", () => {
  it("未知渠道返回 null（绝不回退到 mock，防伪造 webhook）", () => {
    expect(getProvider("nonexistent")).toBeNull();
  });

  it("已注册渠道返回对应 channel", () => {
    expect(getProvider("web_wechat")!.channel).toBe("web_wechat");
    expect(getProvider("web_alipay")!.channel).toBe("web_alipay");
  });
});

describe("密钥安全", () => {
  it("渠道密钥缺失时验签返回 false（不回退默认密钥、不抛未捕获异常）", () => {
    const saved = process.env.PAY_WEB_WECHAT_SECRET;
    delete process.env.PAY_WEB_WECHAT_SECRET;
    const body = "x";
    // 用一个语法合法的十六进制签名，确保是「密钥缺失」而非「签名格式」导致的 false
    const anyHexSig = "a".repeat(64);
    expect(getProvider("web_wechat")!.verifyWebhookSignature(body, anyHexSig)).toBe(false);
    if (saved !== undefined) process.env.PAY_WEB_WECHAT_SECRET = saved;
  });
});
