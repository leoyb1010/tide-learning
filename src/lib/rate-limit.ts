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

/** 取客户端 IP（信任反代 header，退化到 unknown）。 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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
