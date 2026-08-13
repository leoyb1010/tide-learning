import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { validateRequestId } from "./request-id";
import {
  acquireGenerationJobLease,
  finishGenerationJobLease,
  generationJobDedupeKey,
  renewGenerationJobLease,
  GenerationJobLeaseLostError,
  type GenerationJobLease,
} from "./generation-job-lease";
import { reverseCreditOperation } from "./credits";

export const COURSE_OUTLINE_OPERATION_TYPE = "course_outline";

export interface CourseOutlineOperationResponse {
  courseId: string;
  slug: string;
  title: string;
  checkpoint?: boolean;
  genStatus?: string;
  lessons: { id: string; title: string; summary: string | null }[];
}

interface StoredCourseOutlineOperation {
  v: 1;
  payloadHash: string;
  response: CourseOutlineOperationResponse | null;
}

export interface CourseOutlineOperation {
  lease: GenerationJobLease;
  userId: string;
  payloadHash: string;
  operationKey: string;
}

export type StartCourseOutlineOperationResult =
  | { status: "acquired"; operation: CourseOutlineOperation }
  | { status: "replay"; response: CourseOutlineOperationResponse }
  | { status: "running" }
  | { status: "failed" };

type OutlineOperationDb = PrismaClient;

type ReverseOutlineCredits = typeof reverseCreditOperation;

type ExistingCourseOutlineOperationResult = Exclude<StartCourseOutlineOperationResult, { status: "acquired" }>;

/** 冲正存储暂时不可用；客户端必须保留原 requestId，稍后重放同一操作。 */
export class CourseOutlineReversalPendingError extends AppError {
  constructor() {
    super("造课账务正在收敛，请稍后原样重试", 503, true);
    this.name = "CourseOutlineReversalPendingError";
  }
}

export function validateCourseOutlineRequestId(value: unknown): string {
  return validateRequestId(value);
}

export function courseOutlinePayloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex")}`;
}

/**
 * 回放/恢复检查：done 直接回放；活租约报 running；过期租约只做冲正收敛，
 * 绝不重跑供应商。这样可覆盖“用量已结算、Course+回放事务前进程崩溃”窗口。
 */
export async function inspectCourseOutlineOperation(input: {
  userId: string;
  requestId: string;
  payloadHash: string;
}, db: OutlineOperationDb = prisma): Promise<ExistingCourseOutlineOperationResult | null> {
  const userId = requiredText(input.userId, "userId");
  const requestId = validateCourseOutlineRequestId(input.requestId);
  const payloadHash = requiredHash(input.payloadHash);
  const dedupeKey = generationJobDedupeKey(COURSE_OUTLINE_OPERATION_TYPE, `${userId}:${requestId}`);
  const existing = await db.generationJob.findUnique({ where: { dedupeKey } });
  if (!existing) return null;
  if (existing.userId !== userId || existing.type !== COURSE_OUTLINE_OPERATION_TYPE) {
    throw new AppError("requestId 已被其它操作占用", 409, false);
  }
  const stored = parseStored(existing.inputJson);
  const payloadMatches = stored.payloadHash === payloadHash;
  if (existing.status === "done") {
    if (!payloadMatches) throw new AppError("requestId 不能用于不同的造课输入，请重新发起", 409, false);
    if (!stored.response) throw new AppError("造课已完成但回放快照缺失，请联系支持", 409, false);
    return { status: "replay", response: stored.response };
  }
  if (existing.status === "running" || existing.status === "queued") {
    const now = new Date();
    const live = existing.status === "running" && existing.leaseUntil && existing.leaseUntil.getTime() > now.getTime();
    if (live) {
      if (!payloadMatches) throw new AppError("requestId 不能用于不同的造课输入，请重新发起", 409, false);
      return { status: "running" };
    }
    // 即使客户端此时已改了 payload，也要先收敛旧 requestId 的未决账务；
    // 不能因 payload drift 提前返回，把崩溃后的已结算用量留给 worker 碰运气。
    const recovered = await recoverExpiredCourseOutlineRow(existing, stored, db, now);
    if (!payloadMatches) throw new AppError("requestId 不能用于不同的造课输入，请重新发起", 409, false);
    return recovered;
  }
  if (!payloadMatches) throw new AppError("requestId 不能用于不同的造课输入，请重新发起", 409, false);
  return { status: "failed" };
}

/**
 * 首次造课的耐久幂等 owner。已存在的 running（包括过期 lease）不再发供应商：
 * 过期不证明 HTTP 已停止，自动接管会重复扣费与建课。用户使用新 requestId 才是新意图。
 */
export async function startCourseOutlineOperation(input: {
  userId: string;
  requestId: string;
  payloadHash: string;
}, db: OutlineOperationDb = prisma): Promise<StartCourseOutlineOperationResult> {
  const userId = requiredText(input.userId, "userId");
  const requestId = validateCourseOutlineRequestId(input.requestId);
  const payloadHash = requiredHash(input.payloadHash);
  const businessKey = `${userId}:${requestId}`;
  const dedupeKey = generationJobDedupeKey(COURSE_OUTLINE_OPERATION_TYPE, businessKey);

  const existing = await inspectCourseOutlineOperation({ userId, requestId, payloadHash }, db);
  if (existing) return existing;
  const initial: StoredCourseOutlineOperation = { v: 1, payloadHash, response: null };
  const lease = await acquireGenerationJobLease({
    userId,
    type: COURSE_OUTLINE_OPERATION_TYPE,
    businessKey,
    inputJson: JSON.stringify(initial),
  }, db);
  if (!lease) {
    const raced = await inspectCourseOutlineOperation({ userId, requestId, payloadHash }, db);
    if (raced) return raced;
    throw new AppError("造课任务认领失败，请稍后重试", 409, false);
  }
  return { status: "acquired", operation: { lease, userId, payloadHash, operationKey: lease.jobId } };
}

/** Course/Lessons 与幂等 response 在同一事务收敛，不留“已建课但无法回放”窗口。 */
export async function completeCourseOutlineOperation(
  tx: Prisma.TransactionClient,
  operation: CourseOutlineOperation,
  courseId: string,
  response: CourseOutlineOperationResponse,
): Promise<void> {
  const stored: StoredCourseOutlineOperation = { v: 1, payloadHash: operation.payloadHash, response };
  const finished = await tx.generationJob.updateMany({
    where: {
      id: operation.lease.jobId,
      userId: operation.userId,
      type: COURSE_OUTLINE_OPERATION_TYPE,
      status: "running",
      fencingToken: operation.lease.fencingToken,
    },
    data: {
      status: "done",
      resultRef: courseId,
      inputJson: JSON.stringify(stored),
      finishedAt: new Date(),
      heartbeatAt: new Date(),
      leaseUntil: null,
      errorMessage: null,
    },
  });
  if (finished.count !== 1) throw new AppError("造课任务所有权已变更", 409, false);
}

/**
 * 未交付大纲的唯一终态收敛入口。顺序是安全协议的一部分：
 * 1. 先续租证明当前 fencing owner；2. 先持久化冲正墓碑；3. 再 fenced finish failed。
 * 冲正失败时只把本 token 的租约立即过期，保持 running 可恢复，绝不冻结成 failed。
 */
export async function reconcileCourseOutlineOperationFailure(
  operation: CourseOutlineOperation,
  errorMessage: string,
  db: OutlineOperationDb = prisma,
  reverse: ReverseOutlineCredits = reverseCreditOperation,
): Promise<ExistingCourseOutlineOperationResult> {
  const renewed = await renewGenerationJobLease({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
  }, db);
  if (!renewed) throw new GenerationJobLeaseLostError();
  operation = { ...operation, lease: renewed };

  try {
    await reverse({
      operationKey: operation.operationKey,
      userId: operation.userId,
      scene: "generate_course",
      reason: "造课大纲未完整交付",
    }, db);
  } catch (error) {
    const now = new Date();
    // 不吞错；仅放开当前 fence 供立即重试。更新失败也只会等原租约自然过期。
    await db.generationJob.updateMany({
      where: {
        id: operation.lease.jobId,
        userId: operation.userId,
        type: COURSE_OUTLINE_OPERATION_TYPE,
        status: "running",
        fencingToken: operation.lease.fencingToken,
      },
      data: {
        leaseUntil: now,
        heartbeatAt: now,
        errorMessage: "billing reversal pending",
      },
    }).catch(() => undefined);
    console.error("[course-outline-operation] billing reversal deferred:", error);
    throw new CourseOutlineReversalPendingError();
  }

  const finished = await finishGenerationJobLease({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    status: "failed",
    errorMessage: errorMessage.slice(0, 1_000),
  }, db);
  if (!finished) throw new GenerationJobLeaseLostError();
  return { status: "failed" };
}

/** 生产 worker 每轮小批收敛过期大纲 operation；只冲正，从不重跑 LLM。 */
export async function reconcileExpiredCourseOutlineOperations(
  limit = 20,
  db: OutlineOperationDb = prisma,
  now = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be between 1 and 100");
  const rows = await db.generationJob.findMany({
    where: {
      type: COURSE_OUTLINE_OPERATION_TYPE,
      status: { in: ["running", "queued"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: [{ leaseUntil: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  let reconciled = 0;
  for (const row of rows) {
    try {
      const result = await recoverExpiredCourseOutlineRow(row, parseStored(row.inputJson), db, now);
      if (result.status === "failed" || result.status === "replay") reconciled += 1;
    } catch (error) {
      console.error("[course-outline-operation] stale reconciliation failed:", error);
    }
  }
  return reconciled;
}

async function recoverExpiredCourseOutlineRow(
  row: Prisma.GenerationJobGetPayload<Record<string, never>>,
  stored: StoredCourseOutlineOperation,
  db: OutlineOperationDb,
  now: Date,
): Promise<ExistingCourseOutlineOperationResult> {
  if (row.status === "done") {
    if (!stored.response) throw new AppError("造课已完成但回放快照缺失，请联系支持", 409, false);
    return { status: "replay", response: stored.response };
  }
  if (row.status !== "running" && row.status !== "queued") return { status: "failed" };
  if (row.status === "running" && row.leaseUntil && row.leaseUntil.getTime() > now.getTime()) {
    return { status: "running" };
  }
  const businessKey = outlineBusinessKey(row.dedupeKey, row.userId);
  const lease = await acquireGenerationJobLease({
    userId: row.userId,
    type: COURSE_OUTLINE_OPERATION_TYPE,
    businessKey,
    preserveExistingInputJson: true,
    now,
  }, db);
  if (!lease) {
    const latest = await db.generationJob.findUniqueOrThrow({ where: { id: row.id } });
    const latestStored = parseStored(latest.inputJson);
    if (latest.status === "done") {
      if (!latestStored.response) throw new AppError("造课已完成但回放快照缺失，请联系支持", 409, false);
      return { status: "replay", response: latestStored.response };
    }
    return latest.status === "failed" || latest.status === "paused"
      ? { status: "failed" }
      : { status: "running" };
  }
  return reconcileCourseOutlineOperationFailure({
    lease,
    userId: row.userId,
    payloadHash: stored.payloadHash,
    operationKey: lease.jobId,
  }, "course outline operation expired before delivery; credits reversed", db);
}

function outlineBusinessKey(dedupeKey: string | null, userId: string): string {
  try {
    const prefix = "generation-job:v1:";
    if (!dedupeKey?.startsWith(prefix)) throw new Error("prefix");
    const tuple = JSON.parse(dedupeKey.slice(prefix.length)) as unknown;
    if (!Array.isArray(tuple) || tuple[0] !== COURSE_OUTLINE_OPERATION_TYPE || typeof tuple[1] !== "string") {
      throw new Error("shape");
    }
    const businessKey = tuple[1];
    if (!businessKey.startsWith(`${userId}:`)) throw new Error("owner");
    return businessKey;
  } catch {
    throw new AppError("造课幂等任务业务键已损坏，请联系支持", 409, false);
  }
}

function parseStored(value: string): StoredCourseOutlineOperation {
  try {
    const raw = JSON.parse(value) as Partial<StoredCourseOutlineOperation>;
    if (raw?.v !== 1 || typeof raw.payloadHash !== "string") throw new Error("shape");
    return {
      v: 1,
      payloadHash: requiredHash(raw.payloadHash),
      response: raw.response && typeof raw.response === "object"
        ? raw.response as CourseOutlineOperationResponse
        : null,
    };
  } catch {
    throw new AppError("造课幂等快照已损坏，请联系支持", 409, false);
  }
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableJson(item)]));
  }
  return value;
}

function requiredText(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must not be empty`);
  return value.trim();
}

function requiredHash(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new TypeError("payloadHash is invalid");
  return value;
}
