import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  completeCourseOutlineOperation,
  courseOutlinePayloadHash,
  inspectCourseOutlineOperation,
  reconcileCourseOutlineOperationFailure,
  reconcileExpiredCourseOutlineOperations,
  startCourseOutlineOperation,
} from "@/lib/course-outline-operation";
import { reserveCredits, settleLlmUsage } from "@/lib/credits";
import { acquireGenerationJobLease } from "@/lib/generation-job-lease";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const clients: PrismaClient[] = [];
let tempDir = "";
const USER_ID = "course-outline-operation-user";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-course-outline-operation-"));
  const dbPath = join(tempDir, "outline.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  for (let index = 0; index < 4; index++) {
    clients.push(new PrismaClient({ datasources: { db: { url: datasourceUrl } } }));
  }
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: USER_ID, nickname: "Outline operation user" } });
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clients[0].llmUsage.deleteMany();
  await clients[0].creditLedger.deleteMany();
  await clients[0].creditReservation.deleteMany();
  await clients[0].llmBillingOperationReversal.deleteMany();
  await clients[0].generationJob.deleteMany();
  await clients[0].lesson.deleteMany();
  await clients[0].course.deleteMany();
  await clients[0].creditAccount.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, balance: 100, totalEarned: 100 },
    update: { balance: 100, totalEarned: 100, totalSpent: 0 },
  });
});

function operationInput(requestId: string, prompt = "学习 TypeScript 基础") {
  return {
    userId: USER_ID,
    requestId,
    payloadHash: courseOutlinePayloadHash({ prompt, category: "ai_skill", checkpoint: false }),
  };
}

describe("durable course outline requestId protocol", () => {
  it("allows exactly one concurrent owner and never reopens an existing running request", async () => {
    const input = operationInput("course-outline-concurrent-0001");
    const results = await Promise.all([
      startCourseOutlineOperation(input, clients[0]),
      startCourseOutlineOperation(input, clients[1]),
      startCourseOutlineOperation(input, clients[2]),
    ]);

    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "running")).toHaveLength(2);
    await expect(clients[0].generationJob.count({ where: { type: "course_outline" } })).resolves.toBe(1);
  });

  it("rejects payload drift for the same requestId before another supplier call", async () => {
    const requestId = "course-outline-payload-drift-01";
    await startCourseOutlineOperation(operationInput(requestId), clients[0]);

    await expect(startCourseOutlineOperation(
      operationInput(requestId, "一个不同的课程需求"),
      clients[1],
    )).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].generationJob.count()).resolves.toBe(1);
  });

  it("commits course, lessons and replay snapshot in one transaction", async () => {
    const input = operationInput("course-outline-complete-replay-1");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;

    const response = await clients[0].$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          id: "outline-operation-course",
          slug: "outline-operation-course",
          title: "TypeScript 基础",
          category: "ai_skill",
          level: "L1",
          status: "published",
          origin: "ai_generated",
          visibility: "private",
          authorUserId: USER_ID,
          genStatus: "generating",
        },
      });
      const lesson = await tx.lesson.create({
        data: {
          id: "outline-operation-lesson",
          courseId: course.id,
          title: "类型系统",
          summary: "能够说明基础类型",
          sortOrder: 0,
          status: "published",
        },
      });
      const snapshot = {
        courseId: course.id,
        slug: course.slug,
        title: course.title,
        lessons: [{ id: lesson.id, title: lesson.title, summary: lesson.summary }],
      };
      await completeCourseOutlineOperation(tx, started.operation, course.id, snapshot);
      return snapshot;
    });

    await expect(inspectCourseOutlineOperation(input, clients[1])).resolves.toEqual({
      status: "replay",
      response,
    });
    await expect(clients[0].course.count()).resolves.toBe(1);
    await expect(clients[0].lesson.count()).resolves.toBe(1);
  });

  it("reverses before freezing a failed requestId and only its fenced owner can settle failure", async () => {
    const input = operationInput("course-outline-failed-request-1");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;

    await expect(reconcileCourseOutlineOperationFailure(
      started.operation,
      "supplier failed",
      clients[0],
    )).resolves.toEqual({ status: "failed" });
    await expect(reconcileCourseOutlineOperationFailure(
      started.operation,
      "duplicate",
      clients[1],
    )).rejects.toMatchObject({ name: "GenerationJobLeaseLostError" });
    await expect(inspectCourseOutlineOperation(input, clients[2])).resolves.toEqual({ status: "failed" });
  });

  it("takes over an expired post-settlement crash, refunds once, and never reruns the supplier", async () => {
    const input = operationInput("course-outline-settled-crash-01");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const reservation = await reserveCredits({
      reservationKey: `${started.operation.operationKey}:outline:attempt:0`,
      operationKey: started.operation.operationKey,
      userId: USER_ID,
      scene: "generate_course",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, {
      promptTokens: 1_000,
      completionTokens: 3_000,
      totalTokens: 4_000,
      model: "deepseek-chat",
    }, `${reservation.reservationKey}:usage`, clients[1]);
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 96, totalSpent: 4 });
    await clients[0].generationJob.update({
      where: { id: started.operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });

    await expect(inspectCourseOutlineOperation(input, clients[2])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 100, totalSpent: 0 });
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: started.operation.lease.jobId } }))
      .resolves.toMatchObject({ status: "failed", attempts: 2 });
    await expect(clients[0].llmBillingOperationReversal.count({
      where: { operationKey: started.operation.operationKey },
    })).resolves.toBe(1);
    await expect(clients[0].creditLedger.count({
      where: { type: "llm_operation_refund", refId: reservation.id },
    })).resolves.toBe(1);
    await expect(clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .resolves.toMatchObject({ status: "reversed", remainingCredits: 0 });
    await expect(inspectCourseOutlineOperation(input, clients[3])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].llmBillingOperationReversal.count()).resolves.toBe(1);
    await expect(clients[0].creditLedger.count({ where: { type: "llm_operation_refund" } })).resolves.toBe(1);
  });

  it("keeps reversal failures running and immediately recoverable on the next retry", async () => {
    const input = operationInput("course-outline-reversal-retry-01");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    let attempts = 0;
    const failOnce = async () => {
      attempts += 1;
      throw new Error("reversal storage unavailable");
    };

    await expect(reconcileCourseOutlineOperationFailure(
      started.operation,
      "supplier settled then route crashed",
      clients[0],
      failOnce,
    )).rejects.toMatchObject({ name: "CourseOutlineReversalPendingError", status: 503 });
    const recoverable = await clients[0].generationJob.findUniqueOrThrow({ where: { id: started.operation.lease.jobId } });
    expect(recoverable.status).toBe("running");
    expect(recoverable.leaseUntil!.getTime()).toBeLessThanOrEqual(Date.now());

    await expect(inspectCourseOutlineOperation(input, clients[1])).resolves.toEqual({ status: "failed" });
    expect(attempts).toBe(1);
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: started.operation.lease.jobId } }))
      .resolves.toMatchObject({ status: "failed", attempts: 2 });
    await expect(clients[0].llmBillingOperationReversal.count({
      where: { operationKey: started.operation.operationKey },
    })).resolves.toBe(1);
  });

  it("does not let an old fencing token reverse after a recovery owner takes over", async () => {
    const input = operationInput("course-outline-stale-fence-001");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    await clients[0].generationJob.update({
      where: { id: started.operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });
    const takeover = await acquireGenerationJobLease({
      userId: USER_ID,
      type: "course_outline",
      businessKey: `${USER_ID}:course-outline-stale-fence-001`,
      preserveExistingInputJson: true,
    }, clients[1]);
    expect(takeover?.fencingToken).toBe(started.operation.lease.fencingToken + 1);
    let reversed = false;
    await expect(reconcileCourseOutlineOperationFailure(
      started.operation,
      "stale owner",
      clients[2],
      async () => { reversed = true; return {} as never; },
    )).rejects.toMatchObject({ name: "GenerationJobLeaseLostError" });
    expect(reversed).toBe(false);
    await expect(clients[0].llmBillingOperationReversal.count()).resolves.toBe(0);
  });

  it("worker sweeper closes expired outline jobs even without a retrying browser", async () => {
    const input = operationInput("course-outline-worker-sweep-01");
    const started = await startCourseOutlineOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    await clients[0].generationJob.update({
      where: { id: started.operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });

    await expect(reconcileExpiredCourseOutlineOperations(20, clients[1])).resolves.toBe(1);
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: started.operation.lease.jobId } }))
      .resolves.toMatchObject({ status: "failed", attempts: 2 });
  });
});
