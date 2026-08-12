import { Prisma, type PrismaClient } from "@prisma/client";
import {
  acquireGenerationJobLease,
  DEFAULT_GENERATION_JOB_LEASE_MS,
  finishGenerationJobLease,
  type GenerationJobLease,
  type GenerationJobLeaseDb,
} from "./generation-job-lease";

/** 与 course-gen 主线的 GenerationJob.type 协议值一致。 */
export const RECOVERABLE_COURSE_GEN_JOB_TYPE = "course_gen";
export const DEFAULT_GENERATION_RECOVERY_INTERVAL_MS = 60_000;
const MIN_GENERATION_RECOVERY_INTERVAL_MS = 10_000;
const MAX_GENERATION_RECOVERY_INTERVAL_MS = 60 * 60_000;
const DEFAULT_RECOVERY_SCAN_LIMIT = 20;
const DEFAULT_RECOVERY_CONCURRENCY = 2;

type CourseGenerationRecoveryDb = GenerationJobLeaseDb & Pick<PrismaClient, "course">;

export type CourseGenerationRecoveryRunner = (
  courseId: string,
  userId: string,
  lease: GenerationJobLease,
) => Promise<void>;

export interface RecoverCourseGenerationJobsOptions {
  db?: CourseGenerationRecoveryDb;
  runner?: CourseGenerationRecoveryRunner;
  now?: Date;
  leaseMs?: number;
  /** 单次 tick 最多成功接管的任务数；活 lease/失败 acquire 不消耗此配额。 */
  limit?: number;
  /** DB 候选分页大小。会继续翻页，不会被最旧的活 lease 饿饿。 */
  scanLimit?: number;
  concurrency?: number;
  onError?: (error: unknown, courseId?: string) => void;
  /** 测试可注入；生产默认小批释放过期 AI 预占。 */
  sweepExpiredReservations?: () => Promise<number>;
  /** 测试可注入；生产默认恢复已交付的视觉操作或整组冲正未交付积分。 */
  sweepExpiredPresentationOperations?: () => Promise<number>;
  /** 测试可注入；生产默认冲正进程崩溃后未交付的首次大纲操作。 */
  sweepExpiredOutlineOperations?: () => Promise<number>;
  /** 测试可注入；生产默认冲正进程崩溃后未交付的导入操作。 */
  sweepExpiredImportOperations?: () => Promise<number>;
}

export interface CourseGenerationRecoverySummary {
  scanned: number;
  acquired: number;
  completed: number;
  skipped: number;
  failed: number;
}

interface RecoveryCandidate {
  id: string;
  authorUserId: string | null;
  genStatus: string | null;
  lessons: Array<{ blocksJson: string | null }>;
}

/**
 * 扫描还处于 generating 的课，但不“猜”心跳是否僵死：
 * 每个候选者都必须先经 GenerationJob 原子 acquire，活租约会在 SQL 闸门处返回 null。
 * 因此，多进程同时启动、定时扫描与请求 after() 同时触发都只有一个 owner。
 */
export async function recoverCourseGenerationJobs(
  options: RecoverCourseGenerationJobsOptions = {},
): Promise<CourseGenerationRecoverySummary> {
  const db = options.db ?? await resolveDb();
  const runner = options.runner ?? await resolveRunner();
  const fixedNow = options.now ? validNow(options.now) : null;
  const leaseMs = options.leaseMs ?? DEFAULT_GENERATION_JOB_LEASE_MS;
  const limit = boundedInteger(options.limit, DEFAULT_RECOVERY_SCAN_LIMIT, 1, 100, "limit");
  const scanLimit = boundedInteger(
    options.scanLimit,
    Math.max(DEFAULT_RECOVERY_SCAN_LIMIT, limit),
    1,
    500,
    "scanLimit",
  );
  const concurrency = boundedInteger(
    options.concurrency,
    DEFAULT_RECOVERY_CONCURRENCY,
    1,
    Math.min(8, limit),
    "concurrency",
  );
  const onError = options.onError ?? defaultErrorReporter;

  // 先退还过期预占：即使后面的 course 扫描/DB 查询失败，用户余额也不会继续冻结。
  try {
    const sweep = options.sweepExpiredReservations ?? await resolveReservationSweep(options.db);
    await sweep();
  } catch (error) {
    onError(error);
  }
  // 视觉操作可能在 LLM 已结算后崩溃。与通用 reservation TTL 不同，
  // 它必须按整个 operation 判定“已交付恢复 done / 未交付全组冲正”。
  try {
    const sweep = options.sweepExpiredPresentationOperations ?? await resolvePresentationOperationSweep(options.db);
    await sweep();
  } catch (error) {
    onError(error);
  }
  // 首次大纲是同步 HTTP 调用，但用量结算后进程仍可在 Course+快照事务前崩溃。
  // 过期 owner 只冲正并终结，不重跑供应商。
  try {
    const sweep = options.sweepExpiredOutlineOperations ?? await resolveOutlineOperationSweep(options.db);
    await sweep();
  } catch (error) {
    onError(error);
  }
  // 导入切章同样是同步 HTTP 供应商调用；过期 owner 只冲正，不再解析文件或重跑 LLM。
  try {
    const sweep = options.sweepExpiredImportOperations ?? await resolveImportOperationSweep(options.db);
    await sweep();
  } catch (error) {
    onError(error);
  }

  const summary: CourseGenerationRecoverySummary = {
    scanned: 0,
    acquired: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
  };
  const active = new Set<Promise<void>>();
  let pageCursor: string | undefined;
  let exhausted = false;

  const runAcquired = async (candidate: RecoveryCandidate, lease: GenerationJobLease) => {
    try {
      await runner(candidate.id, candidate.authorUserId!, lease);
      summary.completed += 1;
    } catch (error) {
      summary.failed += 1;
      onError(error, candidate.id);
      // runner 若在进入主线前就抛错，及时释放当前租约；
      // 若已失权，fencing 条件会返回 false，绝不会终结新 owner。
      await finishGenerationJobLease({
        jobId: lease.jobId,
        fencingToken: lease.fencingToken,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "generation recovery runner failed",
        now: fixedNow ?? undefined,
      }, db).catch((finishError) => onError(finishError, candidate.id));
    }
  };

  // limit 是「成功接管上限」而不是「只看最旧 N 条」。按稳定 cursor 继续翻页，
  // 前排活 lease 只会被跳过，后排可接管任务仍能在本 tick 运行。
  while (!exhausted && summary.acquired < limit) {
    const candidates = await db.course.findMany({
      where: { genStatus: { in: ["generating", "paused"] }, authorUserId: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: scanLimit,
      ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
      select: {
        id: true,
        authorUserId: true,
        genStatus: true,
        lessons: { select: { blocksJson: true } },
      },
    }) as RecoveryCandidate[];
    if (candidates.length === 0) break;
    exhausted = candidates.length < scanLimit;
    pageCursor = candidates[candidates.length - 1].id;

    for (const candidate of candidates) {
      if (summary.acquired >= limit) break;
      summary.scanned += 1;
      if (!candidate.authorUserId) {
        summary.skipped += 1;
        continue;
      }
      if (candidate.genStatus === "paused") {
        const running = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "GenerationJob"
          WHERE "type" = ${RECOVERABLE_COURSE_GEN_JOB_TYPE}
            AND "resultRef" = ${candidate.id}
            AND "status" = 'running'
          LIMIT 1
        `);
        if (running.length === 0) {
          summary.skipped += 1;
          continue;
        }
      }
      const now = fixedNow ? new Date(fixedNow.getTime()) : new Date();
      const initialProgress = JSON.stringify({
        total: candidate.lessons.length,
        done: candidate.lessons.filter((lesson) => lesson.blocksJson !== null).length,
        failed: 0,
        currentLessonId: null,
        heartbeatAt: now.toISOString(),
      });
      let lease: GenerationJobLease | null;
      try {
        lease = await acquireGenerationJobLease({
          userId: candidate.authorUserId,
          type: RECOVERABLE_COURSE_GEN_JOB_TYPE,
          businessKey: candidate.id,
          resultRef: candidate.id,
          inputJson: initialProgress,
          preserveExistingInputJson: true,
          leaseMs,
          now,
        }, db);
      } catch (error) {
        summary.failed += 1;
        onError(error, candidate.id);
        continue;
      }
      if (!lease) {
        summary.skipped += 1;
        continue;
      }

      summary.acquired += 1;
      // pause 信号与 owner 在边界 finish 之间若进程硬死，会留下
      // Course=paused + Job=running/expired。新 token 只做免费终态收敛，绝不启动 runner。
      if (candidate.genStatus === "paused") {
        try {
          const finished = await finishGenerationJobLease({
            jobId: lease.jobId,
            fencingToken: lease.fencingToken,
            status: "paused",
            now: fixedNow ?? undefined,
          }, db);
          if (finished) summary.completed += 1;
          else summary.failed += 1;
        } catch (error) {
          summary.failed += 1;
          onError(error, candidate.id);
        }
        continue;
      }
      const work = runAcquired(candidate, lease);
      active.add(work);
      void work.finally(() => active.delete(work));
      if (active.size >= concurrency) await Promise.race(active);
    }
  }

  await Promise.all(active);
  return summary;
}

export interface GenerationRecoveryWorkerController {
  tick: () => Promise<CourseGenerationRecoverySummary | null>;
  stop: () => void;
}

export interface StartGenerationRecoveryWorkerOptions extends RecoverCourseGenerationJobsOptions {
  intervalMs?: number;
}

interface GenerationWorkerState {
  running: boolean;
  timer: ReturnType<typeof setInterval>;
  controller: GenerationRecoveryWorkerController;
}

type WorkerGlobal = typeof globalThis & { __tideGenerationRecoveryWorker?: GenerationWorkerState };

/**
 * 生产 Node + SQLite 默认启用；可显式 GENERATION_WORKER_ENABLED=0 停用。
 * 非 SQLite 不自启，因为当前迁移与原子 UPSERT 均以 SQLite 为发布真值。
 */
export function shouldStartGenerationRecoveryWorker(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.GENERATION_WORKER_ENABLED === "0") return false;
  if (!env.DATABASE_URL?.startsWith("file:")) return false;
  if (env.GENERATION_WORKER_ENABLED === "1") return env.NEXT_RUNTIME === "nodejs";
  return env.NODE_ENV === "production" && env.NEXT_RUNTIME === "nodejs";
}

/** 进程单例定时器：启动立即扫一次，之后周期扫描；unref 不阻碍优雅退出。 */
export function startGenerationRecoveryWorker(
  options: StartGenerationRecoveryWorkerOptions = {},
): GenerationRecoveryWorkerController {
  const global = globalThis as WorkerGlobal;
  if (global.__tideGenerationRecoveryWorker) return global.__tideGenerationRecoveryWorker.controller;

  const intervalMs = boundedInteger(
    options.intervalMs ?? intervalFromEnv(process.env.GENERATION_WORKER_INTERVAL_MS),
    DEFAULT_GENERATION_RECOVERY_INTERVAL_MS,
    MIN_GENERATION_RECOVERY_INTERVAL_MS,
    MAX_GENERATION_RECOVERY_INTERVAL_MS,
    "intervalMs",
  );
  let stopped = false;
  const state = {} as GenerationWorkerState;
  const controller: GenerationRecoveryWorkerController = {
    tick: async () => {
      if (stopped || state.running) return null;
      state.running = true;
      try {
        return await recoverCourseGenerationJobs(options);
      } catch (error) {
        (options.onError ?? defaultErrorReporter)(error);
        return null;
      } finally {
        state.running = false;
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(state.timer);
      if (global.__tideGenerationRecoveryWorker === state) delete global.__tideGenerationRecoveryWorker;
    },
  };
  state.running = false;
  state.controller = controller;
  state.timer = setInterval(() => void controller.tick(), intervalMs);
  state.timer.unref?.();
  global.__tideGenerationRecoveryWorker = state;
  void controller.tick();
  return controller;
}

async function resolveDb(): Promise<CourseGenerationRecoveryDb> {
  return (await import("./db")).prisma;
}

async function resolveRunner(): Promise<CourseGenerationRecoveryRunner> {
  const courseGen = await import("./course-gen");
  // course-gen 与 worker 是动态边界，避免 instrumentation edge 解析期静态拉入 Prisma。
  return courseGen.runCourseGenBackground as unknown as CourseGenerationRecoveryRunner;
}

async function resolveReservationSweep(db?: CourseGenerationRecoveryDb): Promise<() => Promise<number>> {
  const credits = await import("./credits");
  return db
    ? () => credits.releaseExpiredCreditReservations(50, db as PrismaClient)
    : () => credits.releaseExpiredCreditReservations(50);
}

async function resolvePresentationOperationSweep(db?: CourseGenerationRecoveryDb): Promise<() => Promise<number>> {
  const operations = await import("./course-presentation-operation");
  return db
    ? () => operations.reconcileExpiredCoursePresentationOperations(20, db as PrismaClient)
    : () => operations.reconcileExpiredCoursePresentationOperations(20);
}

async function resolveOutlineOperationSweep(db?: CourseGenerationRecoveryDb): Promise<() => Promise<number>> {
  const operations = await import("./course-outline-operation");
  return db
    ? () => operations.reconcileExpiredCourseOutlineOperations(20, db as PrismaClient)
    : () => operations.reconcileExpiredCourseOutlineOperations(20);
}

async function resolveImportOperationSweep(db?: CourseGenerationRecoveryDb): Promise<() => Promise<number>> {
  const operations = await import("./import-operation");
  return db
    ? () => operations.reconcileExpiredImportOperations(20, db as PrismaClient)
    : () => operations.reconcileExpiredImportOperations(20);
}

function intervalFromEnv(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("GENERATION_WORKER_INTERVAL_MS must be an integer");
  return parsed;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function validNow(value: Date | undefined): Date {
  const now = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date");
  return now;
}

function defaultErrorReporter(error: unknown, courseId?: string): void {
  console.error(
    `[generation-worker] recovery failed${courseId ? ` for ${courseId}` : ""}:`,
    error,
  );
}
