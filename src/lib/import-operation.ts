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

export const IMPORT_OPERATION_TYPE = "import_structure";

export interface ImportOperationResponse {
  courseId: string;
  slug: string;
  title: string;
  charCount: number;
  lessons: { id: string; title: string; summary: string | null }[];
  checkpoint?: boolean;
  directReady?: true;
  faithfulKind?: "presentation" | "scorm";
}

interface StoredImportOperation {
  v: 1;
  payloadHash: string;
  response: ImportOperationResponse | null;
}

export interface ImportOperation {
  lease: GenerationJobLease;
  userId: string;
  payloadHash: string;
  operationKey: string;
}

export type StartImportOperationResult =
  | { status: "acquired"; operation: ImportOperation }
  | { status: "replay"; response: ImportOperationResponse }
  | { status: "running" }
  | { status: "failed" };

type ExistingImportOperationResult = Exclude<StartImportOperationResult, { status: "acquired" }>;
type ImportOperationDb = PrismaClient;
type ReverseImportCredits = typeof reverseCreditOperation;

export class ImportReversalPendingError extends AppError {
  constructor() {
    super("导入账务正在收敛，请稍后原样重试", 503, true);
    this.name = "ImportReversalPendingError";
  }
}

export function validateImportRequestId(value: unknown): string {
  return validateRequestId(value);
}

export function importContentSha256(value: string | Buffer | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function importPayloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex")}`;
}

export async function inspectImportOperation(input: {
  userId: string;
  requestId: string;
  payloadHash: string;
}, db: ImportOperationDb = prisma): Promise<ExistingImportOperationResult | null> {
  const userId = requiredText(input.userId, "userId");
  const requestId = validateImportRequestId(input.requestId);
  const payloadHash = requiredHash(input.payloadHash);
  const dedupeKey = generationJobDedupeKey(IMPORT_OPERATION_TYPE, `${userId}:${requestId}`);
  const existing = await db.generationJob.findUnique({ where: { dedupeKey } });
  if (!existing) return null;
  if (existing.userId !== userId || existing.type !== IMPORT_OPERATION_TYPE) {
    throw new AppError("requestId 已被其它操作占用", 409, false);
  }
  const stored = parseStored(existing.inputJson);
  const payloadMatches = stored.payloadHash === payloadHash;
  if (existing.status === "done") {
    if (!payloadMatches) throw new AppError("requestId 不能用于不同的导入内容，请重新发起", 409, false);
    if (!stored.response) throw new AppError("导入已完成但回放快照缺失，请联系支持", 409, false);
    return { status: "replay", response: stored.response };
  }
  if (existing.status === "running" || existing.status === "queued") {
    const now = new Date();
    const live = existing.status === "running" && existing.leaseUntil && existing.leaseUntil.getTime() > now.getTime();
    if (live) {
      if (!payloadMatches) throw new AppError("requestId 不能用于不同的导入内容，请重新发起", 409, false);
      return { status: "running" };
    }
    const recovered = await recoverExpiredImportRow(existing, stored, db, now);
    if (!payloadMatches) throw new AppError("requestId 不能用于不同的导入内容，请重新发起", 409, false);
    return recovered;
  }
  if (!payloadMatches) throw new AppError("requestId 不能用于不同的导入内容，请重新发起", 409, false);
  return { status: "failed" };
}

export async function startImportOperation(input: {
  userId: string;
  requestId: string;
  payloadHash: string;
}, db: ImportOperationDb = prisma): Promise<StartImportOperationResult> {
  const userId = requiredText(input.userId, "userId");
  const requestId = validateImportRequestId(input.requestId);
  const payloadHash = requiredHash(input.payloadHash);
  const businessKey = `${userId}:${requestId}`;
  const existing = await inspectImportOperation({ userId, requestId, payloadHash }, db);
  if (existing) return existing;
  const lease = await acquireGenerationJobLease({
    userId,
    type: IMPORT_OPERATION_TYPE,
    businessKey,
    inputJson: JSON.stringify({ v: 1, payloadHash, response: null } satisfies StoredImportOperation),
  }, db);
  if (!lease) {
    const raced = await inspectImportOperation({ userId, requestId, payloadHash }, db);
    if (raced) return raced;
    throw new AppError("导入任务认领失败，请稍后重试", 409, false);
  }
  return {
    status: "acquired",
    operation: { lease, userId, payloadHash, operationKey: lease.jobId },
  };
}

/** Course / ImportedSource / Lessons 与客户端回放快照必须在同一事务完成。 */
export async function completeImportOperation(
  tx: Prisma.TransactionClient,
  operation: ImportOperation,
  courseId: string,
  response: ImportOperationResponse,
): Promise<void> {
  const stored: StoredImportOperation = { v: 1, payloadHash: operation.payloadHash, response };
  const now = new Date();
  const finished = await tx.generationJob.updateMany({
    where: {
      id: operation.lease.jobId,
      userId: operation.userId,
      type: IMPORT_OPERATION_TYPE,
      status: "running",
      fencingToken: operation.lease.fencingToken,
    },
    data: {
      status: "done",
      resultRef: courseId,
      inputJson: JSON.stringify(stored),
      finishedAt: now,
      heartbeatAt: now,
      leaseUntil: null,
      errorMessage: null,
    },
  });
  if (finished.count !== 1) throw new AppError("导入任务所有权已变更", 409, false);
}

export async function reconcileImportOperationFailure(
  operation: ImportOperation,
  errorMessage: string,
  db: ImportOperationDb = prisma,
  reverse: ReverseImportCredits = reverseCreditOperation,
): Promise<ExistingImportOperationResult> {
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
      scene: "import_source",
      reason: "导入课程未完整交付",
    }, db);
  } catch (error) {
    const now = new Date();
    await db.generationJob.updateMany({
      where: {
        id: operation.lease.jobId,
        userId: operation.userId,
        type: IMPORT_OPERATION_TYPE,
        status: "running",
        fencingToken: operation.lease.fencingToken,
      },
      data: { leaseUntil: now, heartbeatAt: now, errorMessage: "billing reversal pending" },
    }).catch(() => undefined);
    console.error("[import-operation] billing reversal deferred:", error);
    throw new ImportReversalPendingError();
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

export async function reconcileExpiredImportOperations(
  limit = 20,
  db: ImportOperationDb = prisma,
  now = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be between 1 and 100");
  const rows = await db.generationJob.findMany({
    where: {
      type: IMPORT_OPERATION_TYPE,
      status: { in: ["running", "queued"] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: [{ leaseUntil: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  let reconciled = 0;
  for (const row of rows) {
    try {
      const result = await recoverExpiredImportRow(row, parseStored(row.inputJson), db, now);
      if (result.status === "failed" || result.status === "replay") reconciled += 1;
    } catch (error) {
      console.error("[import-operation] stale reconciliation failed:", error);
    }
  }
  return reconciled;
}

async function recoverExpiredImportRow(
  row: Prisma.GenerationJobGetPayload<Record<string, never>>,
  stored: StoredImportOperation,
  db: ImportOperationDb,
  now: Date,
): Promise<ExistingImportOperationResult> {
  if (row.status === "done") {
    if (!stored.response) throw new AppError("导入已完成但回放快照缺失，请联系支持", 409, false);
    return { status: "replay", response: stored.response };
  }
  if (row.status !== "running" && row.status !== "queued") return { status: "failed" };
  if (row.status === "running" && row.leaseUntil && row.leaseUntil.getTime() > now.getTime()) return { status: "running" };
  const businessKey = importBusinessKey(row.dedupeKey, row.userId);
  const lease = await acquireGenerationJobLease({
    userId: row.userId,
    type: IMPORT_OPERATION_TYPE,
    businessKey,
    preserveExistingInputJson: true,
    now,
  }, db);
  if (!lease) {
    const latest = await db.generationJob.findUniqueOrThrow({ where: { id: row.id } });
    const latestStored = parseStored(latest.inputJson);
    if (latest.status === "done") {
      if (!latestStored.response) throw new AppError("导入已完成但回放快照缺失，请联系支持", 409, false);
      return { status: "replay", response: latestStored.response };
    }
    return latest.status === "failed" || latest.status === "paused" ? { status: "failed" } : { status: "running" };
  }
  return reconcileImportOperationFailure({
    lease,
    userId: row.userId,
    payloadHash: stored.payloadHash,
    operationKey: lease.jobId,
  }, "import operation expired before delivery; credits reversed", db);
}

function importBusinessKey(dedupeKey: string | null, userId: string): string {
  try {
    const prefix = "generation-job:v1:";
    if (!dedupeKey?.startsWith(prefix)) throw new Error("prefix");
    const tuple = JSON.parse(dedupeKey.slice(prefix.length)) as unknown;
    if (!Array.isArray(tuple) || tuple[0] !== IMPORT_OPERATION_TYPE || typeof tuple[1] !== "string") throw new Error("shape");
    const businessKey = tuple[1];
    if (!businessKey.startsWith(`${userId}:`)) throw new Error("owner");
    return businessKey;
  } catch {
    throw new AppError("导入幂等任务业务键已损坏，请联系支持", 409, false);
  }
}

function parseStored(value: string): StoredImportOperation {
  try {
    const raw = JSON.parse(value) as Partial<StoredImportOperation>;
    if (raw?.v !== 1 || typeof raw.payloadHash !== "string") throw new Error("shape");
    return {
      v: 1,
      payloadHash: requiredHash(raw.payloadHash),
      response: raw.response && typeof raw.response === "object" ? raw.response as ImportOperationResponse : null,
    };
  } catch {
    throw new AppError("导入幂等快照已损坏，请联系支持", 409, false);
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
