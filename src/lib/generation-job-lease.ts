import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/** 默认租约 5 分钟；调用方应在此窗口内按进度点续租。 */
export const DEFAULT_GENERATION_JOB_LEASE_MS = 5 * 60_000;
const MAX_GENERATION_JOB_LEASE_MS = 24 * 60 * 60_000;

/**
 * 只依赖原子 raw-query 能力，方便测试向真实隔离 SQLite 注入独立 client。
 * 生产调用不传 db 时才惰性读取应用单例，避免测试导入阶段误触开发库。
 */
export type GenerationJobLeaseDb = Pick<PrismaClient, "$queryRaw">;

export interface GenerationJobLease {
  jobId: string;
  dedupeKey: string;
  fencingToken: number;
  leaseUntil: Date;
  heartbeatAt: Date;
}

export interface AcquireGenerationJobLeaseInput {
  userId: string;
  type: string;
  /** resultRef（如 courseId/lessonId）或同等稳定、全生命周期不变的业务键。 */
  businessKey: string;
  resultRef?: string | null;
  inputJson?: string;
  /**
   * 恢复 worker 接管时不应用空快照覆盖已存的 done/failed 进度。
   * 仅影响 ON CONFLICT 接管路径；首次 INSERT 仍写入 inputJson（缺省 {} ）。
   */
  preserveExistingInputJson?: boolean;
  /** 仅显式用户续造/重评可重开 done；启动恢复扫描绝不得开启。 */
  allowCompletedReopen?: boolean;
  leaseMs?: number;
  /** 仅供确定性测试/受控恢复；生产调用省略即使用当前时间。 */
  now?: Date;
}

export interface RenewGenerationJobLeaseInput {
  jobId: string;
  fencingToken: number;
  leaseMs?: number;
  now?: Date;
}

export interface UpdateGenerationJobLeaseProgressInput extends RenewGenerationJobLeaseInput {
  /** 已序列化的 GenProgress 快照；租约存储层不解读业务 JSON。 */
  inputJson: string;
}

export type GenerationJobFinishStatus = "done" | "failed" | "paused";

export interface FinishGenerationJobLeaseInput {
  jobId: string;
  fencingToken: number;
  status: GenerationJobFinishStatus;
  errorMessage?: string | null;
  /** 可选的最终进度快照，与终态在同一条 fencing UPDATE 落库。 */
  inputJson?: string;
  now?: Date;
}

export class GenerationJobLeaseLostError extends Error {
  constructor(message = "generation job lease lost") {
    super(message);
    this.name = "GenerationJobLeaseLostError";
  }
}

interface RawLeaseRow {
  jobId: unknown;
  dedupeKey: unknown;
  fencingToken: unknown;
  leaseUntil: unknown;
  heartbeatAt: unknown;
}

interface RawIdRow {
  jobId: unknown;
}

/**
 * 无分隔符碰撞的稳定键；JSON 会转义冒号、斜线与 Unicode，type/businessKey 顺序固定。
 * userId 不进入键：resultRef 等业务实体 ID 本身应全局唯一，同时 acquire 会额外校验原 job.userId，
 * 防止知道业务键的另一个用户接管任务。
 */
export function generationJobDedupeKey(type: string, businessKey: string): string {
  return `generation-job:v1:${JSON.stringify([
    requiredString(type, "type", 120),
    requiredString(businessKey, "businessKey", 1_024),
  ])}`;
}

/**
 * 原子认领或接管任务。
 *
 * - 首次：INSERT 一行，token=1；
 * - queued/failed/paused 或已过期 running：同一条 UPSERT 原子切到 running，token+1；
 * - 未过期 running、done、不同 user：返回 null，且不改任何字段；
 * - dedupeKey UNIQUE 是最终并发闸门，不依赖进程内 Map。
 */
export async function acquireGenerationJobLease(
  input: AcquireGenerationJobLeaseInput,
  db?: GenerationJobLeaseDb,
): Promise<GenerationJobLease | null> {
  const client = await resolveDb(db);
  const userId = requiredString(input.userId, "userId", 256);
  const type = requiredString(input.type, "type", 120);
  const businessKey = requiredString(input.businessKey, "businessKey", 1_024);
  const dedupeKey = generationJobDedupeKey(type, businessKey);
  const now = validDate(input.now);
  const leaseUntil = addLease(now, input.leaseMs);
  const inputJson = input.inputJson ?? "{}";
  const preserveExistingInputJson = input.preserveExistingInputJson ? 1 : 0;
  const allowCompletedReopen = input.allowCompletedReopen ? 1 : 0;
  const resultRef = input.resultRef ?? null;

  const rows = await client.$queryRaw<RawLeaseRow[]>(Prisma.sql`
    INSERT INTO "GenerationJob" (
      "id", "userId", "type", "dedupeKey", "status", "inputJson", "resultRef",
      "attempts", "createdAt", "finishedAt", "leaseUntil", "heartbeatAt", "fencingToken"
    )
    SELECT
      ${randomUUID()}, ${userId}, ${type}, ${dedupeKey}, 'running', ${inputJson}, ${resultRef},
      1, ${now}, NULL, ${leaseUntil}, ${now}, 1
    FROM "User"
    WHERE "User"."id" = ${userId}
      AND "User"."deletedAt" IS NULL
    ON CONFLICT ("dedupeKey") DO UPDATE SET
      "status" = 'running',
      "inputJson" = CASE
        WHEN ${preserveExistingInputJson} = 1 THEN "GenerationJob"."inputJson"
        ELSE excluded."inputJson"
      END,
      "resultRef" = COALESCE("GenerationJob"."resultRef", excluded."resultRef"),
      "attempts" = "GenerationJob"."attempts" + 1,
      "finishedAt" = NULL,
      "errorMessage" = NULL,
      "leaseUntil" = excluded."leaseUntil",
      "heartbeatAt" = excluded."heartbeatAt",
      "fencingToken" = COALESCE("GenerationJob"."fencingToken", 0) + 1
    WHERE "GenerationJob"."userId" = excluded."userId"
      AND "GenerationJob"."type" = excluded."type"
      AND EXISTS (
        SELECT 1 FROM "User"
        WHERE "User"."id" = excluded."userId"
          AND "User"."deletedAt" IS NULL
      )
      AND (
        "GenerationJob"."status" IN ('queued', 'failed', 'paused')
        OR (${allowCompletedReopen} = 1 AND "GenerationJob"."status" = 'done')
        OR (
          "GenerationJob"."status" = 'running'
          AND (
            "GenerationJob"."leaseUntil" IS NULL
            OR "GenerationJob"."leaseUntil" <= excluded."heartbeatAt"
          )
        )
      )
    RETURNING
      "id" AS "jobId",
      "dedupeKey" AS "dedupeKey",
      "fencingToken" AS "fencingToken",
      "leaseUntil" AS "leaseUntil",
      "heartbeatAt" AS "heartbeatAt"
  `);

  return rows[0] ? normalizeLease(rows[0]) : null;
}

/**
 * 只允许仍未过期且 token 完全匹配的 owner 续租。租约一旦过期，旧 worker 必须重新 acquire；
 * 即使此刻尚无人接管，也不能靠 renew 把已丢失的所有权“复活”。
 */
export async function renewGenerationJobLease(
  input: RenewGenerationJobLeaseInput,
  db?: GenerationJobLeaseDb,
): Promise<GenerationJobLease | null> {
  const client = await resolveDb(db);
  const jobId = requiredString(input.jobId, "jobId", 256);
  const fencingToken = validFencingToken(input.fencingToken);
  const now = validDate(input.now);
  const leaseUntil = addLease(now, input.leaseMs);

  const rows = await client.$queryRaw<RawLeaseRow[]>(Prisma.sql`
    UPDATE "GenerationJob"
    SET "leaseUntil" = ${leaseUntil}, "heartbeatAt" = ${now}
    WHERE "id" = ${jobId}
      AND "status" = 'running'
      AND "fencingToken" = ${fencingToken}
      AND "leaseUntil" IS NOT NULL
      AND "leaseUntil" > ${now}
    RETURNING
      "id" AS "jobId",
      "dedupeKey" AS "dedupeKey",
      "fencingToken" AS "fencingToken",
      "leaseUntil" AS "leaseUntil",
      "heartbeatAt" AS "heartbeatAt"
  `);

  return rows[0] ? normalizeLease(rows[0]) : null;
}

/**
 * 原子写进度 + 续租。这是后台主线的心跳写入口：
 *
 * - 仅当 jobId、fencingToken、running 状态均匹配且旧租约尚未过期时成功；
 * - 一条 SQL 同时写 inputJson/heartbeatAt/leaseUntil，避免“续租成功但进度被新 owner 覆盖”窗口；
 * - 返回 null 就是确定性丢失所有权，调用方必须立即停止后续业务写入。
 */
export async function updateGenerationJobLeaseProgress(
  input: UpdateGenerationJobLeaseProgressInput,
  db?: GenerationJobLeaseDb,
): Promise<GenerationJobLease | null> {
  const client = await resolveDb(db);
  const jobId = requiredString(input.jobId, "jobId", 256);
  const fencingToken = validFencingToken(input.fencingToken);
  const inputJson = validInputJson(input.inputJson);
  const now = validDate(input.now);
  const leaseUntil = addLease(now, input.leaseMs);

  const rows = await client.$queryRaw<RawLeaseRow[]>(Prisma.sql`
    UPDATE "GenerationJob"
    SET
      "inputJson" = ${inputJson},
      "leaseUntil" = ${leaseUntil},
      "heartbeatAt" = ${now}
    WHERE "id" = ${jobId}
      AND "status" = 'running'
      AND "fencingToken" = ${fencingToken}
      AND "leaseUntil" IS NOT NULL
      AND "leaseUntil" > ${now}
    RETURNING
      "id" AS "jobId",
      "dedupeKey" AS "dedupeKey",
      "fencingToken" AS "fencingToken",
      "leaseUntil" AS "leaseUntil",
      "heartbeatAt" AS "heartbeatAt"
  `);

  return rows[0] ? normalizeLease(rows[0]) : null;
}

/**
 * 以 fencing token 条件更新终态。过期/旧 token 返回 false，绝不会终结后来 owner 的新租约。
 * 成功后清 leaseUntil，保留最终 fencingToken 与 heartbeatAt 供审计。
 */
export async function finishGenerationJobLease(
  input: FinishGenerationJobLeaseInput,
  db?: GenerationJobLeaseDb,
): Promise<boolean> {
  const client = await resolveDb(db);
  const jobId = requiredString(input.jobId, "jobId", 256);
  const fencingToken = validFencingToken(input.fencingToken);
  const now = validDate(input.now);
  const status = validFinishStatus(input.status);
  const errorMessage = status === "done" ? null : normalizeError(input.errorMessage);
  const inputJson = input.inputJson === undefined ? null : validInputJson(input.inputJson);

  const rows = await client.$queryRaw<RawIdRow[]>(Prisma.sql`
    UPDATE "GenerationJob"
    SET
      "status" = ${status},
      "finishedAt" = ${now},
      "heartbeatAt" = ${now},
      "leaseUntil" = NULL,
      "errorMessage" = ${errorMessage},
      "inputJson" = CASE WHEN ${inputJson} IS NULL THEN "inputJson" ELSE ${inputJson} END
    WHERE "id" = ${jobId}
      AND "status" = 'running'
      AND "fencingToken" = ${fencingToken}
      AND "leaseUntil" IS NOT NULL
      AND "leaseUntil" > ${now}
    RETURNING "id" AS "jobId"
  `);

  return rows.length === 1;
}

export interface GenerationJobLeaseHeartbeatOptions {
  db?: GenerationJobLeaseDb;
  leaseMs?: number;
  /** 默认 leaseMs/3；生产至少 1s，短租约测试可显式传更小值。 */
  heartbeatEveryMs?: number;
  onLost?: (error: unknown) => void;
}

/**
 * 在一个不可中断的长 LLM/HTML 阶段期间持续续租。
 * 前续租阻止用旧 lease 启动新付费阶段；定时心跳覆盖单次调用超过租期；
 * 后续租确保 task 返回时仍有所有权。任一心跳失败都抛 LeaseLost，调用方不得再写业务真值。
 */
export async function runWithGenerationJobLeaseHeartbeat<T>(
  lease: GenerationJobLease,
  task: () => Promise<T>,
  options: GenerationJobLeaseHeartbeatOptions = {},
): Promise<T> {
  const leaseMs = options.leaseMs ?? DEFAULT_GENERATION_JOB_LEASE_MS;
  const heartbeatEveryMs = options.heartbeatEveryMs ?? Math.max(1_000, Math.floor(leaseMs / 3));
  if (!Number.isSafeInteger(heartbeatEveryMs) || heartbeatEveryMs < 1 || heartbeatEveryMs >= leaseMs) {
    throw new TypeError("heartbeatEveryMs must be a positive integer smaller than leaseMs");
  }
  const renew = () => renewGenerationJobLease({
    jobId: lease.jobId,
    fencingToken: lease.fencingToken,
    leaseMs,
  }, options.db);
  const before = await renew();
  if (!before) throw new GenerationJobLeaseLostError();

  let lost: unknown = null;
  let renewal: Promise<void> | null = null;
  const heartbeat = () => {
    if (lost || renewal) return;
    renewal = renew()
      .then((next) => {
        if (!next) lost = new GenerationJobLeaseLostError();
      })
      .catch((error) => { lost = error; })
      .finally(() => { renewal = null; });
  };
  const timer = setInterval(heartbeat, heartbeatEveryMs);
  timer.unref?.();
  let result: T;
  try {
    result = await task();
  } finally {
    clearInterval(timer);
    if (renewal) await renewal;
  }
  if (lost) {
    options.onLost?.(lost);
    throw lost instanceof GenerationJobLeaseLostError
      ? lost
      : new GenerationJobLeaseLostError(lost instanceof Error ? lost.message : undefined);
  }
  const after = await renew();
  if (!after) throw new GenerationJobLeaseLostError();
  return result;
}

async function resolveDb(db?: GenerationJobLeaseDb): Promise<GenerationJobLeaseDb> {
  if (db) return db;
  return (await import("./db")).prisma;
}

function requiredString(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty`);
  if (normalized.length > maxLength) throw new TypeError(`${name} is too long`);
  return normalized;
}

function validDate(value?: Date): Date {
  const date = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(date.getTime())) throw new TypeError("now must be a valid Date");
  return date;
}

function addLease(now: Date, leaseMs = DEFAULT_GENERATION_JOB_LEASE_MS): Date {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_GENERATION_JOB_LEASE_MS) {
    throw new TypeError(`leaseMs must be an integer between 1 and ${MAX_GENERATION_JOB_LEASE_MS}`);
  }
  return new Date(now.getTime() + leaseMs);
}

function validFencingToken(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("fencingToken must be a positive integer");
  return value;
}

function validFinishStatus(value: GenerationJobFinishStatus): GenerationJobFinishStatus {
  if (value !== "done" && value !== "failed" && value !== "paused") {
    throw new TypeError("status must be done, failed, or paused");
  }
  return value;
}

function normalizeError(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new TypeError("errorMessage must be a string");
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 1_000) : null;
}

function validInputJson(value: string): string {
  if (typeof value !== "string") throw new TypeError("inputJson must be a string");
  // 进度快照不应携带原文资料；限制只是防误用把大文档写进心跳热行。
  if (value.length > 1_000_000) throw new TypeError("inputJson is too long");
  return value;
}

function normalizeLease(row: RawLeaseRow): GenerationJobLease {
  const fencingToken = Number(row.fencingToken);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new Error("GenerationJob returned an invalid fencingToken");
  }
  return {
    jobId: String(row.jobId),
    dedupeKey: String(row.dedupeKey),
    fencingToken,
    leaseUntil: rawDate(row.leaseUntil, "leaseUntil"),
    heartbeatAt: rawDate(row.heartbeatAt, "heartbeatAt"),
  };
}

function rawDate(value: unknown, name: string): Date {
  const date = value instanceof Date ? value : new Date(typeof value === "bigint" ? Number(value) : String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`GenerationJob returned an invalid ${name}`);
  return date;
}
