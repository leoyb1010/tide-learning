import { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 固定窗口限流。开发/测试使用内存；生产默认使用共享磁盘桶，与 SQLite 的单机持久卷部署一致，
 * 可跨进程并在重启后继续生效。多主机部署时应把 RATE_LIMIT_DIR 指向共享文件系统，或改接外部限流层。
 */

type Bucket = { count: number; resetAt: number };
type UniqueRequestBucket = { requestHashes: string[]; resetAt: number };
const buckets = new Map<string, Bucket>();
const uniqueRequestBuckets = new Map<string, UniqueRequestBucket>();
const useFileStore = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_STORE === "file";
const fileRoot = process.env.RATE_LIMIT_DIR || path.join(process.cwd(), ".data", "rate-limits");
let lastFileSweep = 0;

// 周期性清理过期桶，避免内存无限增长
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  for (const [k, b] of uniqueRequestBuckets) if (b.resetAt < now) uniqueRequestBuckets.delete(k);
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface UniqueRequestAdmissionResult extends RateLimitResult {
  /** true 表示该 requestId 已占用过名额，本次只是幂等放行。 */
  duplicate: boolean;
}

/** 对 key 在 windowMs 窗口内限制 limit 次。 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (useFileStore) return fileRateLimit(key, limit, windowMs);
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

function fileRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const hash = createHash("sha256").update(key).digest("hex");
  const file = path.join(fileRoot, `${hash}.json`);
  const lock = path.join(fileRoot, `${hash}.lock`);
  mkdirSync(fileRoot, { recursive: true });

  try {
    writeFileSync(lock, String(now), { flag: "wx", mode: 0o600 });
  } catch {
    // 进程若在持锁时崩溃，5 秒后清理陈旧锁；活跃锁则保守拒绝，避免并发穿透额度。
    let lockedAt = Number.NaN;
    try { lockedAt = Number.parseInt(readFileSync(lock, "utf8"), 10); } catch { /* 锁可能刚释放 */ }
    if (!Number.isFinite(lockedAt) || now - lockedAt <= 5_000) {
      return { ok: false, remaining: 0, retryAfterSec: 1 };
    }
    unlinkSync(lock);
    try {
      writeFileSync(lock, String(now), { flag: "wx", mode: 0o600 });
    } catch {
      return { ok: false, remaining: 0, retryAfterSec: 1 };
    }
  }

  try {
    let bucket: Bucket | null = null;
    try {
      bucket = JSON.parse(readFileSync(file, "utf8")) as Bucket;
    } catch {
      bucket = null;
    }
    if (!bucket || !Number.isFinite(bucket.count) || !Number.isFinite(bucket.resetAt) || bucket.resetAt < now) {
      bucket = { count: 1, resetAt: now + windowMs };
    } else if (bucket.count >= limit) {
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    } else {
      bucket.count += 1;
    }

    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(bucket), { mode: 0o600 });
    renameSync(tmp, file);

    if (now - lastFileSweep >= 60_000) {
      lastFileSweep = now;
      for (const name of readdirSync(fileRoot)) {
        if (!name.endsWith(".json") || name === `${hash}.json`) continue;
        try {
          const stale = JSON.parse(readFileSync(path.join(fileRoot, name), "utf8")) as Bucket;
          if (!Number.isFinite(stale.resetAt) || stale.resetAt < now) unlinkSync(path.join(fileRoot, name));
        } catch {
          unlinkSync(path.join(fileRoot, name));
        }
      }
    }

    return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterSec: 0 };
  } catch (error) {
    console.error("[rate-limit] persistent store failed closed", error);
    return { ok: false, remaining: 0, retryAfterSec: 1 };
  } finally {
    try { unlinkSync(lock); } catch { /* 已清理由下次陈旧锁恢复 */ }
  }
}

/**
 * 在固定窗口内只对新 requestId 计数。已准入的 requestId 即使桶已满也始终放行，
 * 使 durable operation 能继续进入 atomic start 获得 replay/running，而不被粗限流破坏幂等性。
 * requestId 仅以 SHA-256 存储；生产与通用限流共用非业务 DB 的持久化文件目录。
 */
export function admitUniqueRequest(
  key: string,
  requestId: string,
  limit: number,
  windowMs: number,
): UniqueRequestAdmissionResult {
  const requestHash = createHash("sha256").update(requestId).digest("hex");
  if (useFileStore) return fileUniqueRequestAdmission(key, requestHash, limit, windowMs);

  const now = Date.now();
  sweep(now);
  const bucket = uniqueRequestBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    uniqueRequestBuckets.set(key, { requestHashes: [requestHash], resetAt: now + windowMs });
    return { ok: true, duplicate: false, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }
  if (bucket.requestHashes.includes(requestHash)) {
    return { ok: true, duplicate: true, remaining: Math.max(0, limit - bucket.requestHashes.length), retryAfterSec: 0 };
  }
  if (bucket.requestHashes.length >= limit) {
    return { ok: false, duplicate: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.requestHashes.push(requestHash);
  return { ok: true, duplicate: false, remaining: Math.max(0, limit - bucket.requestHashes.length), retryAfterSec: 0 };
}

function fileUniqueRequestAdmission(
  key: string,
  requestHash: string,
  limit: number,
  windowMs: number,
): UniqueRequestAdmissionResult {
  const now = Date.now();
  const hash = createHash("sha256").update(`unique-request:${key}`).digest("hex");
  const file = path.join(fileRoot, `${hash}.unique.json`);
  const lock = path.join(fileRoot, `${hash}.unique.lock`);
  mkdirSync(fileRoot, { recursive: true });

  // 跨进程临界区很短；遇到活跃锁时有界等待，避免同 requestId 并发被误拒。
  // 超时/存储故障仍 fail closed，不以限流可用性换取业务 DB 写放大风险。
  let locked = false;
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  const deadline = now + 1_000;
  while (!locked) {
    const attemptAt = Date.now();
    try {
      writeFileSync(lock, String(attemptAt), { flag: "wx", mode: 0o600 });
      locked = true;
      break;
    } catch {
      let lockedAt = Number.NaN;
      try { lockedAt = Number.parseInt(readFileSync(lock, "utf8"), 10); } catch { /* 锁可能刚释放 */ }
      if (Number.isFinite(lockedAt) && attemptAt - lockedAt > 5_000) {
        try { unlinkSync(lock); } catch { /* 其他进程已恢复 */ }
        continue;
      }
      if (attemptAt >= deadline) {
        return { ok: false, duplicate: false, remaining: 0, retryAfterSec: 1 };
      }
      Atomics.wait(waitCell, 0, 0, 5);
    }
  }

  try {
    let bucket: UniqueRequestBucket | null = null;
    try {
      bucket = JSON.parse(readFileSync(file, "utf8")) as UniqueRequestBucket;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[rate-limit] unique request bucket unreadable", error);
        return { ok: false, duplicate: false, remaining: 0, retryAfterSec: 1 };
      }
    }
    const valid = bucket
      && Array.isArray(bucket.requestHashes)
      && bucket.requestHashes.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
      && Number.isFinite(bucket.resetAt);
    if (bucket && !valid) {
      return { ok: false, duplicate: false, remaining: 0, retryAfterSec: 1 };
    }
    if (!bucket || bucket.resetAt < now) {
      bucket = { requestHashes: [requestHash], resetAt: now + windowMs };
    } else if (bucket.requestHashes.includes(requestHash)) {
      return {
        ok: true,
        duplicate: true,
        remaining: Math.max(0, limit - bucket.requestHashes.length),
        retryAfterSec: 0,
      };
    } else if (bucket.requestHashes.length >= limit) {
      return { ok: false, duplicate: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    } else {
      bucket.requestHashes.push(requestHash);
    }

    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(bucket), { mode: 0o600 });
    renameSync(tmp, file);
    return {
      ok: true,
      duplicate: false,
      remaining: Math.max(0, limit - bucket.requestHashes.length),
      retryAfterSec: 0,
    };
  } catch (error) {
    console.error("[rate-limit] unique request store failed closed", error);
    return { ok: false, duplicate: false, remaining: 0, retryAfterSec: 1 };
  } finally {
    if (locked) {
      try { unlinkSync(lock); } catch { /* 已由其他恢复者清理 */ }
    }
  }
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
// 是否信任入站 x-real-ip（审计 2026-07-12 P2-11）。默认 false：
// x-real-ip 是客户端可任意伪造的普通请求头，只有当反代**强制覆盖**它时才可信。
// 此前无条件优先信任 x-real-ip，盖过了下方已加固的 XFF「取倒数第 N 跳」逻辑——
// 反代若未覆盖 x-real-ip，攻击者每请求换值即得全新限流桶，正是 XFF 想堵的洞。
// 确有可信反代设置 x-real-ip 的部署，显式置 TRUST_PROXY_REAL_IP=1 开启。
const TRUST_PROXY_REAL_IP = process.env.TRUST_PROXY_REAL_IP === "1";

// 共享取 IP 逻辑：NextRequest.headers 与 next/headers 的 ReadonlyHeaders 都实现 get(name)。
function pickClientIp(get: (name: string) => string | null): string {
  // 仅在显式声明可信反代会覆盖 x-real-ip 时才信任它；否则一律走已加固的 XFF「倒数第 N 跳」。
  if (TRUST_PROXY_REAL_IP) {
    const realIp = get("x-real-ip");
    if (realIp) return realIp.trim();
  }
  const xff = get("x-forwarded-for");
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

export function clientIp(req: NextRequest): string {
  return pickClientIp((name) => req.headers.get(name));
}

/** 供 Server Component（无 NextRequest）用：传入 next/headers 的 headers() 结果。 */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string {
  return pickClientIp((name) => h.get(name));
}

export class RateLimitError extends Error {
  status = 429;
  constructor(public retryAfterSec: number) {
    super("请求过于频繁，请稍后再试");
  }
}

/**
 * 纯 key 维度断言：不拼接客户端 IP。
 * 用于登录账号、用户 ID 等必须跨 IP 聚合的身份维度，防止攻击者轮换出口绕过限流。
 */
export function assertKeyRateLimit(key: string, limit: number, windowMs: number) {
  const res = rateLimit(key, limit, windowMs);
  if (!res.ok) throw new RateLimitError(res.retryAfterSec);
  return res;
}

/** 便捷断言：按可信客户端 IP 限流，超限由 handle 统一转成 429。 */
export function assertRateLimit(req: NextRequest, scope: string, limit: number, windowMs: number) {
  return assertKeyRateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
}

/**
 * 按用户维度限流：key 用 userId 而非 IP。
 * 用于 AI 等高成本操作 —— 按 IP 限流会误伤同 NAT/校园网用户，按账号更精准且不可通过换 IP 绕过。
 */
export function assertUserRateLimit(userId: string, scope: string, limit: number, windowMs: number) {
  return assertKeyRateLimit(`${scope}:user:${userId}`, limit, windowMs);
}

/**
 * 按用户 + 业务 scope 约束窗口内的“唯一新 requestId”数。
 * 放在 durable inspect 之后、业务 DB atomic start 之前，用来给换 ID 写放大设硬上限。
 */
export function assertUniqueRequestAdmission(
  userId: string,
  scope: string,
  requestId: string,
  limit: number,
  windowMs: number,
) {
  const res = admitUniqueRequest(`unique-admission:${scope}:user:${userId}`, requestId, limit, windowMs);
  if (!res.ok) throw new RateLimitError(res.retryAfterSec);
  return res;
}
