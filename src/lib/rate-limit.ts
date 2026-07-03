import { NextRequest } from "next/server";

/**
 * A1-7：进程内滑动窗口限流。
 * 单实例足够拦住暴力枚举 / 刷量；多实例生产应换 Redis（接口保持不变）。
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// 周期性清理过期桶，避免内存无限增长
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** 对 key 在 windowMs 窗口内限制 limit 次。 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/**
 * 取客户端 IP 用于限流。
 * 安全要点（A1-5）：X-Forwarded-For 的**首段是客户端可任意伪造的**——攻击者每次换一个
 * 首段即可获得全新限流桶、绕过 IP 限流。真实客户端 IP 应取「可信反代追加的那一跳」。
 * XFF 形如 `client, proxy1, proxy2`，最右侧由最靠近应用的可信反代写入，最难伪造。
 * 用 TRUSTED_PROXY_HOPS 声明可信反代层数（默认 1）：取倒数第 N 段作为客户端 IP。
 * 优先信任平台注入的不可伪造 header（x-real-ip 由反代设置）。
 */
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
export function clientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      // 取倒数第 TRUSTED_PROXY_HOPS 段：反代之后、客户端无法越过反代覆盖的那一跳
      const idx = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      return parts[idx];
    }
  }
  return "unknown";
}

export class RateLimitError extends Error {
  status = 429;
  constructor(public retryAfterSec: number) {
    super("请求过于频繁，请稍后再试");
  }
}

/** 便捷断言：超限直接抛 RateLimitError（由 handle 统一转 429）。 */
export function assertRateLimit(req: NextRequest, scope: string, limit: number, windowMs: number) {
  const res = rateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
  if (!res.ok) throw new RateLimitError(res.retryAfterSec);
  return res;
}

/**
 * 按用户维度限流：key 用 userId 而非 IP。
 * 用于 AI 等高成本操作 —— 按 IP 限流会误伤同 NAT/校园网用户，按账号更精准且不可通过换 IP 绕过。
 */
export function assertUserRateLimit(userId: string, scope: string, limit: number, windowMs: number) {
  const res = rateLimit(`${scope}:user:${userId}`, limit, windowMs);
  if (!res.ok) throw new RateLimitError(res.retryAfterSec);
  return res;
}
