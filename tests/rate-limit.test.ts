import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  assertKeyRateLimit,
  assertRateLimit,
  admitUniqueRequest,
  assertUniqueRequestAdmission,
  RateLimitError,
} from "@/lib/rate-limit";

const WINDOW_MS = 60_000;
let sequence = 0;
const cleanupDirs: string[] = [];

afterEach(() => {
  delete process.env.RATE_LIMIT_STORE;
  delete process.env.RATE_LIMIT_DIR;
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

describe("唯一 requestId 准入", () => {
  it("同 requestId 只计一次，桶满后仍放行；新 ID 被拒绝", () => {
    const key = unique("unique-admission");

    expect(admitUniqueRequest(key, "request-a", 2, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: false, remaining: 1,
    });
    expect(admitUniqueRequest(key, "request-a", 2, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: true, remaining: 1,
    });
    expect(admitUniqueRequest(key, "request-b", 2, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: false, remaining: 0,
    });
    expect(admitUniqueRequest(key, "request-a", 2, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: true, remaining: 0,
    });
    expect(admitUniqueRequest(key, "request-c", 2, WINDOW_MS)).toMatchObject({
      ok: false, duplicate: false, remaining: 0,
    });
  });

  it("用户与 scope 分桶，新 ID 超限抛出可回传 Retry-After 的 429", () => {
    const user = unique("unique-user");
    expect(() => assertUniqueRequestAdmission(user, "course", "request-a", 1, WINDOW_MS)).not.toThrow();
    expect(() => assertUniqueRequestAdmission(user, "import", "request-b", 1, WINDOW_MS)).not.toThrow();
    expect(() => assertUniqueRequestAdmission(`${user}-other`, "course", "request-b", 1, WINDOW_MS)).not.toThrow();
    expect(() => assertUniqueRequestAdmission(user, "course", "request-a", 1, WINDOW_MS)).not.toThrow();

    try {
      assertUniqueRequestAdmission(user, "course", "request-c", 1, WINDOW_MS);
      throw new Error("expected unique request admission limit");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("文件存储在模块/进程实例间共享同 ID 幂等与新 ID 上限", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tide-unique-admission-"));
    cleanupDirs.push(dir);
    process.env.RATE_LIMIT_STORE = "file";
    process.env.RATE_LIMIT_DIR = dir;

    vi.resetModules();
    const first = await import("@/lib/rate-limit");
    expect(first.admitUniqueRequest("shared-key", "request-a", 1, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: false, remaining: 0,
    });

    vi.resetModules();
    const second = await import("@/lib/rate-limit");
    expect(second.admitUniqueRequest("shared-key", "request-a", 1, WINDOW_MS)).toMatchObject({
      ok: true, duplicate: true, remaining: 0,
    });
    expect(second.admitUniqueRequest("shared-key", "request-b", 1, WINDOW_MS)).toMatchObject({
      ok: false, duplicate: false, remaining: 0,
    });
  });
});
