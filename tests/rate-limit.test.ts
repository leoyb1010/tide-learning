import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  assertKeyRateLimit,
  assertRateLimit,
  RateLimitError,
} from "@/lib/rate-limit";

const WINDOW_MS = 60_000;
let sequence = 0;

function unique(prefix: string) {
  sequence += 1;
  return `test:${prefix}:${Date.now()}:${sequence}`;
}

function requestFromIp(ip: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "x-real-ip": ip },
  });
}

function loginAttempt(accountKey: string, ip: string, ipScope: string) {
  assertKeyRateLimit(accountKey, 5, WINDOW_MS);
  assertRateLimit(requestFromIp(ip), ipScope, 20, WINDOW_MS);
}

describe("登录双维度限流", () => {
  it("固定账号与固定 IP 的第 6 次尝试触发账号限流", () => {
    const accountKey = unique("account-fixed-ip");
    const ipScope = unique("ip-fixed-account");

    for (let i = 0; i < 5; i += 1) {
      expect(() => loginAttempt(accountKey, "198.51.100.10", ipScope)).not.toThrow();
    }

    expect(() => loginAttempt(accountKey, "198.51.100.10", ipScope)).toThrow(RateLimitError);
  });

  it("固定账号轮换 IP 时第 6 次仍触发账号限流", () => {
    const accountKey = unique("account-rotating-ip");
    const ipScope = unique("ip-rotating");

    for (let i = 0; i < 5; i += 1) {
      expect(() => loginAttempt(accountKey, `198.51.100.${20 + i}`, ipScope)).not.toThrow();
    }

    expect(() => loginAttempt(accountKey, "198.51.100.99", ipScope)).toThrow(RateLimitError);
  });

  it("固定 IP 轮换账号时第 21 次触发 IP 限流", () => {
    const ipScope = unique("ip-dictionary");

    for (let i = 0; i < 20; i += 1) {
      expect(() => loginAttempt(unique(`account-${i}`), "203.0.113.25", ipScope)).not.toThrow();
    }

    expect(() => loginAttempt(unique("account-21"), "203.0.113.25", ipScope)).toThrow(RateLimitError);
  });

  it("限流异常包含可用于 Retry-After 的正整数秒数", () => {
    const key = unique("retry-after");
    assertKeyRateLimit(key, 1, WINDOW_MS);

    try {
      assertKeyRateLimit(key, 1, WINDOW_MS);
      throw new Error("expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterSec).toBeGreaterThan(0);
      expect(Number.isInteger((error as RateLimitError).retryAfterSec)).toBe(true);
    }
  });
});
