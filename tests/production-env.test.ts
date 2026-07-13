import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProductionEnv } from "@/instrumentation";

const VALID = {
  DATABASE_URL: "file:/var/lib/tide/prod.db",
  NEXT_PUBLIC_PAY_CHANNEL: "stripe",
  STRIPE_SECRET_KEY: "sk_live_redacted",
  STRIPE_WEBHOOK_SECRET: "whsec_redacted",
  NEXT_PUBLIC_SITE_URL: "https://learn.example.com",
  NEXT_PUBLIC_APP_URL: "https://learn.example.com",
  STREAM_SIGNING_SECRET: "x".repeat(40),
  STORAGE_MODE: "local",
  TRUSTED_PROXY_HOPS: "1",
  MEDIA_DIR: "/var/lib/tide/media",
  UPLOAD_DIR: "/var/lib/tide/uploads",
  RATE_LIMIT_DIR: "/var/lib/tide/rate-limits",
  LOG_DIR: "/var/log/tide",
};

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(VALID)) vi.stubEnv(key, value);
  vi.stubEnv("ALLOW_LOCAL_PRODUCTION", "");
  vi.stubEnv("MOCK_PAY_ENABLED", "");
  vi.stubEnv("APPLE_IAP_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("生产配置 fail-fast", () => {
  it("接受完整真实生产配置", () => expect(() => validateProductionEnv()).not.toThrow());

  it("拒绝 mock 支付、本地 URL 和相对持久化目录", () => {
    vi.stubEnv("NEXT_PUBLIC_PAY_CHANNEL", "mock");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.stubEnv("MEDIA_DIR", ".data/media");
    expect(() => validateProductionEnv()).toThrow(/stripe[\s\S]*HTTPS[\s\S]*MEDIA_DIR/);
  });

  it("Apple IAP 启用时要求完整校验参数", () => {
    vi.stubEnv("APPLE_IAP_ENABLED", "1");
    vi.stubEnv("APPLE_BUNDLE_ID", "");
    vi.stubEnv("APPLE_IAP_ENVIRONMENT", "staging");
    expect(() => validateProductionEnv()).toThrow(/APPLE_BUNDLE_ID[\s\S]*Sandbox 或 Production/);
  });

  it("显式本地生产预览可使用本地 URL，但仍禁止 mock-pay 开关", () => {
    vi.stubEnv("ALLOW_LOCAL_PRODUCTION", "1");
    vi.stubEnv("NEXT_PUBLIC_PAY_CHANNEL", "mock");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3100");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3100");
    for (const key of ["MEDIA_DIR", "UPLOAD_DIR", "RATE_LIMIT_DIR", "LOG_DIR"]) vi.stubEnv(key, "");
    expect(() => validateProductionEnv()).not.toThrow();
    vi.stubEnv("MOCK_PAY_ENABLED", "1");
    expect(() => validateProductionEnv()).toThrow(/禁止 MOCK_PAY_ENABLED/);
  });
});
