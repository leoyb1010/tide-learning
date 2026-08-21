import { describe, expect, it } from "vitest";
import { configuredCheckoutChannel } from "@/lib/payment";

describe("商业化支付闸门", () => {
  it("生产环境没有 Stripe 双密钥时不宣称可支付", () => {
    expect(configuredCheckoutChannel({ NODE_ENV: "production", NEXT_PUBLIC_PAY_CHANNEL: "mock" })).toBeNull();
    expect(configuredCheckoutChannel({ NODE_ENV: "production", NEXT_PUBLIC_PAY_CHANNEL: "stripe", STRIPE_SECRET_KEY: "x", STRIPE_WEBHOOK_SECRET: "y" })).toBe("stripe");
    expect(configuredCheckoutChannel({ NODE_ENV: "development", NEXT_PUBLIC_PAY_CHANNEL: "mock" })).toBe("mock");
  });
});
