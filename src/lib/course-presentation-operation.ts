import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { validateRequestId } from "./request-id";
import { reverseCreditOperation } from "./credits";
import {
  acquireGenerationJobLease,
  finishGenerationJobLease,
  generationJobDedupeKey,
  GenerationJobLeaseLostError,
  renewGenerationJobLease,
  runWithGenerationJobLeaseHeartbeat,
  updateGenerationJobLeaseProgress,
  type GenerationJobLease,
} from "./generation-job-lease";
import { assessCoursePresentation } from "./course-gen";

export const COURSE_PRESENTATION_OPERATION_TYPE = "course_presentation";

export type CoursePresentationOperationKind = "lesson_html" | "custom_theme";

interface StoredCoursePresentationOperation {
  v: 1;
  businessKey: string;
  payloadHash: string;
  kind: CoursePresentationOperationKind;
  courseId: string;
  targetLessonIds: string[];
  themeId: string | null;
  /** custom-theme 开始前的设计引用，失败时只在同 revision 精确恢复。 */
  priorCustomThemeId: string | null;
  priorLessonDesigns: Array<{ lessonId: string; designJson: string | null }>;
  /** 主题应用成功后 exactly-once 增加 usageCount 的持久化标记。 */
  themeUsageCounted: boolean;
  presentationRevision: number | null;
  response: Record<string, unknown> | null;
}

export interface CoursePresentationOperation {
  lease: GenerationJobLease;
  operationKey: string;
  stored: StoredCoursePresentationOperation;
}

export type StartCoursePresentationOperationResult =
  | { status: "acquired"; operation: CoursePresentationOperation }
  | { status: "replay"; response: Record<string, unknown> }
  | { status: "running" }
  | {
    status: "busy";
    activeRequestId: string | null;
    activeKind: CoursePresentationOperationKind;
    activeTargetLessonIds: string[];
  }
  | { status: "failed" };

interface StartCoursePresentationOperationInput {
  userId: string;
  courseId: string;
  requestId: string;
  kind: CoursePresentationOperationKind;
  /** 只参与 hash，不持久化；路由用它绑定同 requestId 的真实输入。 */
  payload: unknown;
  targetLessonIds: string[];
  themeId?: string | null;
  /** custom-theme 路由预读快照的指纹，Course 写序事务内重算并精确比较。 */
  targetSnapshotHash?: string;
}

type PresentationOperationDb = PrismaClient;

export function validatePresentationRequestId(value: unknown): string {
  return validateRequestId(value);
}

/** 对已归一化输入做稳定 hash；对象键排序，数组顺序保留。 */
export function coursePresentationPayloadHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex")}`;
}

/**
 * 只读判定 requestId 是否已有持久化 operation。用于入口在创建 job 前
 * 施加限流/feature gate，同时让已有请求仍能进入 start 做严格身份校验、
 * 交付回放或过期任务收敛。不得用本函数代替 start 的 payload/user 绑定。
 */
export async function coursePresentationOperationExists(
  courseIdValue: string,
  requestIdValue: string,
  db: PresentationOperationDb = prisma,
): Promise<boolean> {
  const courseId = requiredText(courseIdValue, "courseId", 256);
  const requestId = validatePresentationRequestId(requestIdValue);
  const businessKey = `${courseId}:${requestId}`;
  const dedupeKey = generationJobDedupeKey(COURSE_PRESENTATION_OPERATION_TYPE, businessKey);
  return (await db.generationJob.count({ where: { dedupeKey } })) > 0;
}

/**
 * 认领一次用户可见的表现层操作。同 requestId：
 * - payload 不同立即 409；
 * - running 不并发执行；done 原样回放；failed 永不自动重开；
 * - 过期 running 只做交付恢复或账务冲正，绝不再调供应商。
 */
export async function startCoursePresentationOperation(
  input: StartCoursePresentationOperationInput,
  db: PresentationOperationDb = prisma,
): Promise<StartCoursePresentationOperationResult> {
  const userId = requiredText(input.userId, "userId", 256);
  const courseId = requiredText(input.courseId, "courseId", 256);
  const requestId = validatePresentationRequestId(input.requestId);
  const targetLessonIds = [...new Set(input.targetLessonIds.map((id) => requiredText(id, "lessonId", 256)))];
  if (targetLessonIds.length === 0) throw new AppError("课程暂无可重渲的课节", 409);
  const targetSnapshotHash = input.targetSnapshotHash === undefined
    ? null
    : requiredSha256(input.targetSnapshotHash, "targetSnapshotHash");
  const payloadHash = coursePresentationPayloadHash({
    kind: input.kind,
    courseId,
    payload: input.payload,
  });
  const businessKey = `${courseId}:${requestId}`;
  const dedupeKey = generationJobDedupeKey(COURSE_PRESENTATION_OPERATION_TYPE, businessKey);
  const initial: StoredCoursePresentationOperation = {
    v: 1,
    businessKey,
    payloadHash,
    kind: input.kind,
    courseId,
    targetLessonIds,
    themeId: input.themeId ?? null,
    priorCustomThemeId: null,
    priorLessonDesigns: [],
    themeUsageCounted: false,
    presentationRevision: null,
    response: null,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.generationJob.findUnique({ where: { dedupeKey } });
    if (existing) {
      assertOperationIdentity(existing, userId, courseId, initial);
      const stored = parseStoredOperation(existing.inputJson);
      if (existing.status === "done") {
        if (!stored.response) throw new AppError("操作已完成但回放快照缺失，请联系支持", 409, false);
        return { status: "replay", response: stored.response };
      }
      if (existing.status === "failed" || existing.status === "paused") return { status: "failed" };
      if (existing.status === "running" && existing.leaseUntil && existing.leaseUntil.getTime() > Date.now()) {
        return { status: "running" };
      }
      // 只接管过期 running/queued 来收敛，不传 allowCompletedReopen，
      // done/failed 因此永远不会被这条路径重开。
      const recoveryLease = await acquireGenerationJobLease({
        userId,
        type: COURSE_PRESENTATION_OPERATION_TYPE,
        businessKey,
        resultRef: courseId,
        preserveExistingInputJson: true,
      }, db);
      if (!recoveryLease) continue;
      return reconcileAcquiredCoursePresentationOperation({
        lease: recoveryLease,
        operationKey: recoveryLease.jobId,
        stored,
      }, db);
    }

    // 不同 requestId 也不能同时烧同一门课：先对 Course 做 no-op UPDATE
    // 取得 SQLite 写序，再在同一事务重读本 request 与课级活跃 job。
    // 这个数据库闸门阻止 r1/r2 都先通过读检查后各自调供应商。
    const claim = await db.$transaction(async (tx) => {
      const locked = await tx.$executeRaw(Prisma.sql`
        UPDATE "Course"
        SET "presentationRevision" = "presentationRevision"
        WHERE "id" = ${courseId}
          AND "authorUserId" = ${userId}
          AND "status" <> 'archived'
      `);
      if (locked !== 1) throw new AppError("课程不存在、已归档或无权操作", 409, false);

      const winner = await tx.generationJob.findUnique({ where: { dedupeKey } });
      if (winner) return { kind: "existing" as const };
      // custom-theme 在路由读 lessons 与创建 operation 之间可能遇到增删课节。
      // 必须在已取得 Course 写序的事务里精确重验 target set，否则
      // 会只渲旧列表、结算 incomplete 并把真实供应商成本全额冲正。
      if (input.kind === "custom_theme") {
        const currentTargets = await tx.lesson.findMany({
          where: { courseId, blocksJson: { not: null } },
          select: {
            id: true,
            title: true,
            summary: true,
            sortOrder: true,
            blocksJson: true,
            htmlJson: true,
            renderSourceHash: true,
            renderEngine: true,
            designJson: true,
          },
          orderBy: { sortOrder: "asc" },
        });
        const currentIds = currentTargets.map((row) => row.id).sort();
        const expectedIds = [...targetLessonIds].sort();
        if (currentIds.length !== expectedIds.length || currentIds.some((id, index) => id !== expectedIds[index])) {
          throw new AppError("课程结构已变更，请重新应用主题", 409, false);
        }
        if (targetSnapshotHash && coursePresentationPayloadHash(currentTargets) !== targetSnapshotHash) {
          throw new AppError("课程内容或表现已变更，请重新应用主题", 409, false);
        }
      }
      const sameCourse = await tx.generationJob.findFirst({
        where: {
          type: COURSE_PRESENTATION_OPERATION_TYPE,
          resultRef: courseId,
          status: "running",
        },
        orderBy: { createdAt: "asc" },
      });
      if (sameCourse) {
        if (sameCourse.leaseUntil && sameCourse.leaseUntil.getTime() > Date.now()) {
          return { kind: "busy" as const, row: sameCourse };
        }
        return { kind: "stale" as const, row: sameCourse };
      }
      const lease = await acquireGenerationJobLease({
        userId,
        type: COURSE_PRESENTATION_OPERATION_TYPE,
        businessKey,
        resultRef: courseId,
        inputJson: JSON.stringify(initial),
      }, tx);
      return lease ? { kind: "acquired" as const, lease } : { kind: "existing" as const };
    });
    if (claim.kind === "busy") {
      const active = parseStoredOperation(claim.row.inputJson);
      const sameLessonOperation = claim.row.userId === userId && active.courseId === courseId &&
        input.kind === "lesson_html" && active.kind === "lesson_html" &&
        sameStringSet(active.targetLessonIds, targetLessonIds);
      return {
        status: "busy",
        // 只有确认为同用户、同一节的精修才把规范 requestId 交给客户端。
        // 主题/其他节只报忙，不能把不同意图误合并。
        activeRequestId: sameLessonOperation
          ? requestIdFromBusinessKey(active.businessKey, courseId)
          : null,
        activeKind: active.kind,
        activeTargetLessonIds: [...active.targetLessonIds],
      };
    }
    if (claim.kind === "stale") {
      const staleStored = parseStoredOperation(claim.row.inputJson);
      const staleLease = await acquireGenerationJobLease({
        userId: claim.row.userId,
        type: COURSE_PRESENTATION_OPERATION_TYPE,
        businessKey: staleStored.businessKey,
        resultRef: staleStored.courseId,
        preserveExistingInputJson: true,
      }, db);
      if (staleLease) {
        await reconcileAcquiredCoursePresentationOperation({
          lease: staleLease,
          operationKey: staleLease.jobId,
          stored: staleStored,
        }, db);
      }
      continue;
    }
    if (claim.kind === "acquired") {
      return {
        status: "acquired",
        operation: { lease: claim.lease, operationKey: claim.lease.jobId, stored: initial },
      };
    }
    // 并发 winner 已创建行；回到循环严格核对 payload/status。
  }
  throw new AppError("课件操作状态冲突，请稍后重试", 409, false);
}

export async function recordCoursePresentationRevision(
  operation: CoursePresentationOperation,
  presentationRevision: number,
  db: PresentationOperationDb = prisma,
): Promise<CoursePresentationOperation> {
  if (!Number.isSafeInteger(presentationRevision) || presentationRevision < 1) {
    throw new TypeError("presentationRevision must be a positive integer");
  }
  const stored: StoredCoursePresentationOperation = {
    ...operation.stored,
    presentationRevision,
  };
  const renewed = await updateGenerationJobLeaseProgress({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    inputJson: JSON.stringify(stored),
  }, db);
  if (!renewed) throw new GenerationJobLeaseLostError();
  return { ...operation, lease: renewed, stored };
}

/**
 * custom-theme 真正改写 design/customTheme 前持久化小型可恢复快照。
 * HTML 仍由 beginCoursePresentationMutation 的 LessonRevision/blocks fallback 策略管理；
 * 这里只防止重套同主题失败时丢掉原 theme/design 引用。
 */
export async function recordCoursePresentationDesignSnapshot(
  operation: CoursePresentationOperation,
  input: { priorCustomThemeId: string | null; priorLessonDesigns: Array<{ lessonId: string; designJson: string | null }> },
  db: PresentationOperationDb = prisma,
): Promise<CoursePresentationOperation> {
  const expected = new Set(operation.stored.targetLessonIds);
  if (input.priorLessonDesigns.length !== expected.size ||
    input.priorLessonDesigns.some((row) => !expected.delete(row.lessonId) ||
      (row.designJson !== null && typeof row.designJson !== "string"))) {
    throw new TypeError("presentation design snapshot targets do not match operation");
  }
  const stored: StoredCoursePresentationOperation = {
    ...operation.stored,
    priorCustomThemeId: input.priorCustomThemeId,
    priorLessonDesigns: input.priorLessonDesigns.map((row) => ({ ...row })),
  };
  const renewed = await updateGenerationJobLeaseProgress({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    inputJson: JSON.stringify(stored),
  }, db);
  if (!renewed) throw new GenerationJobLeaseLostError();
  return { ...operation, lease: renewed, stored };
}

/** 长 LLM/整课阶段持续心跳；返回前后都必须仍持有同 fencing token。 */
export async function runCoursePresentationOperationStage<T>(
  operation: CoursePresentationOperation,
  task: () => Promise<T>,
  db: PresentationOperationDb = prisma,
): Promise<T> {
  return runWithGenerationJobLeaseHeartbeat(operation.lease, task, { db });
}

export async function completeCoursePresentationOperation(
  operation: CoursePresentationOperation,
  response: Record<string, unknown>,
  db: PresentationOperationDb = prisma,
): Promise<void> {
  const stored: StoredCoursePresentationOperation = { ...operation.stored, response: sanitizeResponse(response) };
  const renewed = await updateGenerationJobLeaseProgress({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    inputJson: JSON.stringify(stored),
  }, db);
  if (!renewed) throw new GenerationJobLeaseLostError();
  const finished = await finishGenerationJobLease({
    jobId: renewed.jobId,
    fencingToken: renewed.fencingToken,
    status: "done",
    inputJson: JSON.stringify(stored),
  }, db);
  if (!finished) throw new GenerationJobLeaseLostError();
}

/**
 * 主题用量与 operation 快照在同一 fenced 事务落库。
 * route 丢包/崩溃后的恢复会重试本函数，themeUsageCounted 保证只加一次。
 */
export async function recordCoursePresentationThemeUsage(
  operation: CoursePresentationOperation,
  db: PresentationOperationDb = prisma,
): Promise<CoursePresentationOperation> {
  if (operation.stored.kind !== "custom_theme" || !operation.stored.themeId ||
    operation.stored.presentationRevision === null) {
    throw new TypeError("theme usage requires a persisted custom-theme presentation revision");
  }
  if (operation.stored.themeUsageCounted) return operation;
  const themeId = operation.stored.themeId;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 5 * 60_000);
  const stored = await db.$transaction(async (tx) => {
    // 先只续租取得 DB 写序，再重读持久化快照。两个携带同一旧内存
    // operation 的并发调用也会串行，后者看到 themeUsageCounted 后 no-op。
    const owner = await tx.generationJob.updateMany({
      where: {
        id: operation.lease.jobId,
        type: COURSE_PRESENTATION_OPERATION_TYPE,
        resultRef: operation.stored.courseId,
        status: "running",
        fencingToken: operation.lease.fencingToken,
        leaseUntil: { gt: now },
      },
      data: { heartbeatAt: now, leaseUntil },
    });
    if (owner.count !== 1) throw new GenerationJobLeaseLostError();
    const job = await tx.generationJob.findUniqueOrThrow({
      where: { id: operation.lease.jobId },
      select: { inputJson: true },
    });
    const current = parseStoredOperation(job.inputJson);
    if (current.kind !== "custom_theme" || current.themeId !== themeId ||
      current.courseId !== operation.stored.courseId ||
      current.presentationRevision !== operation.stored.presentationRevision) {
      throw new GenerationJobLeaseLostError("theme operation snapshot changed");
    }
    if (current.themeUsageCounted) return current;
    const delivered = await tx.course.count({
      where: {
        id: operation.stored.courseId,
        presentationRevision: operation.stored.presentationRevision!,
        genStatus: "ready",
        customThemeId: themeId,
      },
    });
    if (delivered !== 1) throw new GenerationJobLeaseLostError("theme presentation is no longer current");
    const counted = await tx.theme.updateMany({
      where: { id: themeId },
      data: { usageCount: { increment: 1 } },
    });
    if (counted.count !== 1) throw new AppError("皮肤已被删除，无法完成交付", 409, false);
    const next: StoredCoursePresentationOperation = { ...current, themeUsageCounted: true };
    await tx.generationJob.update({
      where: { id: operation.lease.jobId },
      data: { inputJson: JSON.stringify(next) },
    });
    return next;
  });
  return { ...operation, lease: { ...operation.lease, leaseUntil, heartbeatAt: now }, stored };
}

/**
 * Theme PATCH/DELETE 与 custom-theme operation 的共享事务门。调用方须在同一
 * transaction 中继续修改/删除 Theme；no-op UPDATE 使“检查”与后续写共用 SQLite 写序。
 */
export async function assertThemeHasNoLivePresentationOperation(
  tx: Prisma.TransactionClient,
  themeId: string,
): Promise<void> {
  const id = requiredText(themeId, "themeId", 256);
  const locked = await tx.$executeRaw(Prisma.sql`
    UPDATE "Theme" SET "usageCount" = "usageCount" WHERE "id" = ${id}
  `);
  if (locked !== 1) throw new AppError("皮肤不存在", 404, false);
  const candidates = await tx.generationJob.findMany({
    where: {
      type: COURSE_PRESENTATION_OPERATION_TYPE,
      status: "running",
      inputJson: { contains: id },
    },
    select: { inputJson: true },
  });
  const live = candidates.some((row) => {
    try {
      const stored = parseStoredOperation(row.inputJson);
      return stored.kind === "custom_theme" && stored.themeId === id;
    } catch {
      // 破损的 live job 无法证明与本 Theme 无关，fail closed。
      return true;
    }
  });
  if (live) throw new AppError("皮肤正在应用中，请等待课件操作完成", 409, false);
}

/**
 * 失败收敛会先重新判定是否已经交付：可能只是最后 done 回包丢失。
 * 只有当前 revision 未完整交付时才整组冲正，防止把真正成功的产物免单。
 */
export async function reconcileCoursePresentationOperationFailure(
  operation: CoursePresentationOperation,
  db: PresentationOperationDb = prisma,
): Promise<StartCoursePresentationOperationResult> {
  return reconcileAcquiredCoursePresentationOperation(operation, db);
}

/** 生产 worker 每轮清理少量过期视觉 job；只恢复/冲正，从不重跑 LLM。 */
export async function reconcileExpiredCoursePresentationOperations(
  limit = 20,
  db: PresentationOperationDb = prisma,
  now = new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit must be between 1 and 100");
  const rows = await db.generationJob.findMany({
    where: {
      type: COURSE_PRESENTATION_OPERATION_TYPE,
      status: "running",
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: [{ leaseUntil: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  let reconciled = 0;
  for (const row of rows) {
    try {
      const stored = parseStoredOperation(row.inputJson);
      const lease = await acquireGenerationJobLease({
        userId: row.userId,
        type: COURSE_PRESENTATION_OPERATION_TYPE,
        businessKey: stored.businessKey,
        resultRef: stored.courseId,
        preserveExistingInputJson: true,
        now,
      }, db);
      if (!lease) continue;
      await reconcileAcquiredCoursePresentationOperation({ lease, operationKey: lease.jobId, stored }, db, now);
      reconciled += 1;
    } catch (error) {
      console.error("[course-presentation-operation] stale reconciliation failed:", error);
    }
  }
  return reconciled;
}

async function reconcileAcquiredCoursePresentationOperation(
  operation: CoursePresentationOperation,
  db: PresentationOperationDb,
  now = new Date(),
): Promise<StartCoursePresentationOperationResult> {
  // 冲正与清理都是不可撤销副作用，必须先证明本调用仍是当前 fence owner。
  // 否则过期 route 可能在新 worker 已接管并完成交付后错误退费。
  const renewed = await renewGenerationJobLease({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    now,
  }, db);
  if (!renewed) throw new GenerationJobLeaseLostError();
  operation = { ...operation, lease: renewed };

  // complete 先持久化 response 再切 done。response 存在就证明当时已通过
  // presentation settle；后续合法内容编辑不应把已交付的旧操作变成免单。
  if (operation.stored.response) {
    const finished = await finishGenerationJobLease({
      jobId: operation.lease.jobId,
      fencingToken: operation.lease.fencingToken,
      status: "done",
      inputJson: JSON.stringify(operation.stored),
      now,
    }, db);
    if (!finished) throw new GenerationJobLeaseLostError();
    return { status: "replay", response: operation.stored.response };
  }

  const response = await recoverDeliveredResponse(operation.stored, db);
  if (response) {
    if (operation.stored.kind === "custom_theme" && !operation.stored.themeUsageCounted) {
      operation = await recordCoursePresentationThemeUsage(operation, db);
    }
    const stored = { ...operation.stored, response };
    const finished = await finishGenerationJobLease({
      jobId: operation.lease.jobId,
      fencingToken: operation.lease.fencingToken,
      status: "done",
      inputJson: JSON.stringify(stored),
      now,
    }, db);
    if (!finished) throw new GenerationJobLeaseLostError();
    return { status: "replay", response };
  }

  // 先删除当前 revision 下未完整交付的付费派生层，再冲正。
  // 这个顺序保证不存在“钱已退、精品 HTML 仍可消费”的崩溃窗口；
  // revision CAS 又保证旧操作绝不清理新 owner 的产物。
  await clearUndeliveredPresentationArtifacts(operation.stored, db);
  await reverseCreditOperation({
    operationKey: operation.operationKey,
    userId: await operationUserId(operation, db),
    scene: "generate_lesson_html",
    reason: "课件表现层操作未完整交付",
    now,
  }, db);
  const finished = await finishGenerationJobLease({
    jobId: operation.lease.jobId,
    fencingToken: operation.lease.fencingToken,
    status: "failed",
    errorMessage: "course presentation operation was not delivered; credits reversed",
    now,
  }, db);
  if (!finished) throw new GenerationJobLeaseLostError();
  return { status: "failed" };
}

async function recoverDeliveredResponse(
  stored: StoredCoursePresentationOperation,
  db: PresentationOperationDb,
): Promise<Record<string, unknown> | null> {
  if (stored.presentationRevision === null) return null;
  const course = await db.course.findUnique({
    where: { id: stored.courseId },
    select: {
      id: true,
      status: true,
      genStatus: true,
      presentationRevision: true,
      customThemeId: true,
      title: true,
      category: true,
      template: true,
      designJson: true,
      lessons: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          summary: true,
          sortOrder: true,
          blocksJson: true,
          htmlJson: true,
          renderSourceHash: true,
          renderEngine: true,
          designJson: true,
        },
      },
    },
  });
  if (!course || course.status === "archived" || course.genStatus !== "ready" ||
    course.presentationRevision !== stored.presentationRevision) {
    return null;
  }
  const targetLessons = course.lessons.filter((lesson) => stored.targetLessonIds.includes(lesson.id));
  if (targetLessons.length !== stored.targetLessonIds.length) return null;
  // 崩溃恢复必须与正式 settle/发布门共用真值：非空 HTML + engine
  // 不足以证明交付，contract checksum 或 sourceHash 旧/脏都必须 fail closed。
  const presentation = assessCoursePresentation(course);
  if (presentation.status === "incomplete" || presentation.ready !== presentation.total) return null;
  const presentationStatus = presentation.status === "ready" ? "premium" : "degraded";

  if (stored.kind === "lesson_html") {
    const lesson = targetLessons.find((row) => row.id === stored.targetLessonIds[0]);
    if (!lesson) return null;
    return {
      lessonId: lesson.id,
      engine: lesson.renderEngine,
      presentationStatus,
    };
  }
  if (!stored.themeId || course.customThemeId !== stored.themeId ||
    presentation.status !== "ready" || presentation.premiumRenderCount !== presentation.total) {
    return null;
  }
  return {
    themeId: stored.themeId,
    affected: stored.targetLessonIds.length,
    rendered: stored.targetLessonIds.length,
    fallback: 0,
    presentationStatus: "premium",
  };
}

/**
 * 清理最终未交付的本次表现层产物。只有 Course 仍处于本 operation
 * 持久化的 revision 才允许写；若用户已开始新 revision，整个事务 no-op。
 */
async function clearUndeliveredPresentationArtifacts(
  stored: StoredCoursePresentationOperation,
  db: PresentationOperationDb,
): Promise<boolean> {
  if (stored.presentationRevision === null) return false;
  return db.$transaction(async (tx) => {
    const current = await tx.course.findUnique({
      where: { id: stored.courseId },
      select: { presentationRevision: true, customThemeId: true },
    });
    if (!current || current.presentationRevision !== stored.presentationRevision) return false;

    const restoreAppliedTheme = stored.kind === "custom_theme" && Boolean(stored.themeId) &&
      current.customThemeId === stored.themeId;
    const owned = await tx.course.updateMany({
      where: { id: stored.courseId, presentationRevision: stored.presentationRevision },
      data: {
        genStatus: "failed",
        premiumRenderCount: 0,
        deterministicRenderCount: 0,
        ...(restoreAppliedTheme ? { customThemeId: stored.priorCustomThemeId } : {}),
      },
    });
    if (owned.count !== 1) return false;

    await tx.lesson.updateMany({
      where: { courseId: stored.courseId, id: { in: stored.targetLessonIds } },
      data: {
        htmlJson: null,
        htmlGenClaimedAt: null,
        renderEngine: null,
        renderSourceHash: null,
        renderRejectReason: null,
        renderDurationMs: null,
      },
    });
    if (restoreAppliedTheme) {
      for (const row of stored.priorLessonDesigns) {
        await tx.lesson.updateMany({
          where: { id: row.lessonId, courseId: stored.courseId },
          data: { designJson: row.designJson },
        });
      }
    }
    return true;
  });
}

async function operationUserId(operation: CoursePresentationOperation, db: PresentationOperationDb): Promise<string> {
  const job = await db.generationJob.findUnique({ where: { id: operation.lease.jobId }, select: { userId: true } });
  if (!job) throw new AppError("课件操作记录不存在", 404, false);
  return job.userId;
}

function assertOperationIdentity(
  row: { userId: string; type: string; resultRef: string | null; inputJson: string },
  userId: string,
  courseId: string,
  expected: StoredCoursePresentationOperation,
): void {
  if (row.userId !== userId || row.type !== COURSE_PRESENTATION_OPERATION_TYPE || row.resultRef !== courseId) {
    throw new AppError("requestId 已被其它操作占用", 409, false);
  }
  const stored = parseStoredOperation(row.inputJson);
  if (stored.payloadHash !== expected.payloadHash || stored.kind !== expected.kind ||
    stored.courseId !== courseId || stored.businessKey !== expected.businessKey) {
    throw new AppError("requestId 不能用于不同的课件操作", 409, false);
  }
}

function parseStoredOperation(value: string): StoredCoursePresentationOperation {
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { throw new AppError("课件操作快照损坏", 409, false); }
  const row = raw as Partial<StoredCoursePresentationOperation> | null;
  // 兼容本发布前已创建的 v1 job：新增的设计快照只用于失败恢复，
  // 缺失时安全默认为无可恢复引用，不得影响 done 回放/老任务对账。
  const priorCustomThemeId = row?.priorCustomThemeId === undefined ? null : row.priorCustomThemeId;
  const priorLessonDesigns = row?.priorLessonDesigns === undefined ? [] : row.priorLessonDesigns;
  const themeUsageCounted = row?.themeUsageCounted === undefined ? false : row.themeUsageCounted;
  if (!row || row.v !== 1 || typeof row.businessKey !== "string" || typeof row.payloadHash !== "string" ||
    (row.kind !== "lesson_html" && row.kind !== "custom_theme") || typeof row.courseId !== "string" ||
    !Array.isArray(row.targetLessonIds) || row.targetLessonIds.some((id) => typeof id !== "string") ||
    (row.themeId !== null && typeof row.themeId !== "string") ||
    (priorCustomThemeId !== null && typeof priorCustomThemeId !== "string") ||
    !Array.isArray(priorLessonDesigns) || priorLessonDesigns.some((item) => !item ||
      typeof item.lessonId !== "string" || (item.designJson !== null && typeof item.designJson !== "string")) ||
    typeof themeUsageCounted !== "boolean" ||
    (row.presentationRevision !== null && (!Number.isSafeInteger(row.presentationRevision) || row.presentationRevision! < 1)) ||
    (row.response !== null && (typeof row.response !== "object" || Array.isArray(row.response)))) {
    throw new AppError("课件操作快照损坏", 409, false);
  }
  return { ...row, priorCustomThemeId, priorLessonDesigns, themeUsageCounted } as StoredCoursePresentationOperation;
}

function sanitizeResponse(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length > 10_000) throw new TypeError("presentation response is too large");
  return JSON.parse(serialized) as Record<string, unknown>;
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJson(item)]));
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("payload contains a non-finite number");
  return value;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return expected.size === left.length && right.every((value) => expected.has(value));
}

function requestIdFromBusinessKey(businessKey: string, courseId: string): string | null {
  const prefix = `${courseId}:`;
  if (!businessKey.startsWith(prefix)) return null;
  try {
    return validatePresentationRequestId(businessKey.slice(prefix.length));
  } catch {
    return null;
  }
}

function requiredText(value: string, name: string, max: number): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${name} is invalid`);
  return normalized;
}

function requiredSha256(value: string, name: string): string {
  const normalized = requiredText(value, name, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${name} is invalid`);
  return normalized;
}
