import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configuredCheckoutChannel } from "@/lib/payment";

describe("商业化支付闸门", () => {
  it("生产环境没有 Stripe 双密钥时不宣称可支付", () => {
    expect(configuredCheckoutChannel({ NODE_ENV: "production", NEXT_PUBLIC_PAY_CHANNEL: "mock" })).toBeNull();
    expect(configuredCheckoutChannel({ NODE_ENV: "production", NEXT_PUBLIC_PAY_CHANNEL: "stripe", STRIPE_SECRET_KEY: "x", STRIPE_WEBHOOK_SECRET: "y" })).toBe("stripe");
    expect(configuredCheckoutChannel({ NODE_ENV: "development", NEXT_PUBLIC_PAY_CHANNEL: "mock" })).toBe("mock");
  });
});

  it("pricing copy stays truthful about free generation and unavailable payment", () => {
    const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
    const card = readFileSync("src/components/SubscriptionCard.tsx", "utf8");
    expect(pricing).toContain("freeCourseGenQuota");
    expect(pricing).toContain("每月体验额度");
    expect(pricing).toContain("rights.map((r, i)");
    const cta = card.slice(card.indexOf("const ctaText"), card.indexOf("const benefits"));
    expect(cta.indexOf('!paymentAvailable')).toBeLessThan(cta.indexOf('!isLoggedIn'));
  });
