import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertThemeHasNoLivePresentationOperation,
  completeCoursePresentationOperation,
  coursePresentationOperationExists,
  recordCoursePresentationDesignSnapshot,
  recordCoursePresentationRevision,
  recordCoursePresentationThemeUsage,
  reconcileCoursePresentationOperationFailure,
  coursePresentationPayloadHash,
  startCoursePresentationOperation,
} from "@/lib/course-presentation-operation";
import { reserveCredits, settleLlmUsage } from "@/lib/credits";
import { buildContract } from "@/lib/ai/courseware-html";
import { renderSourceHash } from "@/lib/ai/courseware-gen";
import { resolveCourseDesign } from "@/lib/ai/courseware-design";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";
import { acquireGenerationJobLease } from "@/lib/generation-job-lease";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const clients: PrismaClient[] = [];
let tempDir = "";

const USER_ID = "presentation-operation-user";
const COURSE_ID = "presentation-operation-course";
const LESSON_1 = "presentation-operation-lesson-1";
const LESSON_2 = "presentation-operation-lesson-2";

function operationInput(requestId: string, kind: "lesson_html" | "custom_theme" = "lesson_html") {
  return {
    userId: USER_ID,
    courseId: COURSE_ID,
    requestId,
    kind,
    payload: kind === "lesson_html"
      ? { lessonId: LESSON_1, enhance: true, model: null }
      : { courseId: COURSE_ID, themeId: "theme-1" },
    targetLessonIds: kind === "lesson_html" ? [LESSON_1] : [LESSON_1, LESSON_2],
    themeId: kind === "custom_theme" ? "theme-1" : null,
  } as const;
}

const usage = (totalTokens: number) => ({
  promptTokens: Math.floor(totalTokens / 3),
  completionTokens: totalTokens - Math.floor(totalTokens / 3),
  totalTokens,
  model: "deepseek-chat",
});

async function storeValidPresentation(
  engines: Partial<Record<string, "llm" | "deterministic">> = {
    [LESSON_1]: "llm",
    [LESSON_2]: "llm",
  },
) {
  const course = await clients[0].course.findUniqueOrThrow({
    where: { id: COURSE_ID },
    include: { lessons: { orderBy: { sortOrder: "asc" } } },
  });
  const design = resolveCourseDesign(course);
  const mode = resolveCoursewareMode({
    title: course.title,
    template: course.template,
    artKey: design.art.key,
    layout: design.art.layout,
  });
  for (const lesson of course.lessons) {
    const engine = engines[lesson.id];
    if (!engine) continue;
    await clients[0].lesson.update({
      where: { id: lesson.id },
      data: {
        htmlJson: JSON.stringify(buildContract(`<!doctype html><html><body>${lesson.id}</body></html>`)),
        renderEngine: engine,
        renderSourceHash: renderSourceHash({
          blocksJson: lesson.blocksJson,
          title: lesson.title,
          summary: lesson.summary,
          sortOrder: lesson.sortOrder,
          design,
          lessonDesignJson: lesson.designJson,
          mode,
        }),
      },
    });
  }
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-presentation-operation-"));
  const dbPath = join(tempDir, "presentation.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  for (let index = 0; index < 5; index++) {
    clients.push(new PrismaClient({ datasources: { db: { url: datasourceUrl } } }));
  }
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: USER_ID, nickname: "Presentation Operation User" } });
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clients[0].llmBillingReconciliation.deleteMany();
  await clients[0].llmUsage.deleteMany();
  await clients[0].creditLedger.deleteMany();
  await clients[0].creditReservation.deleteMany();
  await clients[0].llmBillingOperationReversal.deleteMany();
  await clients[0].generationJob.deleteMany();
  await clients[0].lesson.deleteMany();
  await clients[0].course.deleteMany();
  await clients[0].theme.deleteMany();
  await clients[0].creditAccount.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, balance: 100, totalEarned: 100 },
    update: { balance: 100, totalEarned: 100, totalSpent: 0 },
  });
  await clients[0].course.create({
    data: {
      id: COURSE_ID,
      slug: COURSE_ID,
      title: "Presentation operation course",
      category: "career",
      level: "L1",
      status: "draft",
      origin: "user_created",
      visibility: "private",
      authorUserId: USER_ID,
      genStatus: "failed",
      lessons: {
        create: [
          { id: LESSON_1, title: "Lesson 1", sortOrder: 0, blocksJson: '{"version":1,"blocks":[]}' },
          { id: LESSON_2, title: "Lesson 2", sortOrder: 1, blocksJson: '{"version":1,"blocks":[]}' },
        ],
      },
    },
  });
  await clients[0].theme.create({
    data: {
      id: "theme-1",
      slug: "presentation-operation-theme",
      ownerId: USER_ID,
      name: "Presentation operation theme",
      tokensJson: "{}",
    },
  });
});

describe("durable course presentation requestId protocol", () => {
  it("allows one concurrent owner and rejects payload drift for the same requestId", async () => {
    const input = operationInput("request-id-concurrent-0001");
    await expect(coursePresentationOperationExists(input.courseId, input.requestId, clients[0])).resolves.toBe(false);
    const results = await Promise.all([
      startCoursePresentationOperation(input, clients[0]),
      startCoursePresentationOperation(input, clients[1]),
      startCoursePresentationOperation(input, clients[2]),
    ]);
    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "running")).toHaveLength(2);
    await expect(clients[0].generationJob.count()).resolves.toBe(1);
    await expect(coursePresentationOperationExists(input.courseId, input.requestId, clients[0])).resolves.toBe(true);

    await expect(startCoursePresentationOperation({
      ...input,
      payload: { lessonId: LESSON_1, enhance: false, model: null },
    }, clients[3])).rejects.toMatchObject({ status: 409 });
  });

  it("hands a second tab the canonical same-lesson request and replays without new billing", async () => {
    const left = operationInput("request-id-course-lock-left");
    const right = operationInput("request-id-course-lock-right");
    const results = await Promise.all([
      startCoursePresentationOperation(left, clients[0]),
      startCoursePresentationOperation(right, clients[1]),
    ]);

    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "busy")).toHaveLength(1);
    const winnerIndex = results.findIndex((result) => result.status === "acquired");
    const winnerInput = winnerIndex === 0 ? left : right;
    const winner = results[winnerIndex];
    const busy = results[1 - winnerIndex];
    expect(busy).toMatchObject({
      status: "busy",
      activeRequestId: winnerInput.requestId,
      activeKind: "lesson_html",
      activeTargetLessonIds: [LESSON_1],
    });
    await expect(clients[0].generationJob.count({
      where: { type: "course_presentation", resultRef: COURSE_ID, status: "running" },
    })).resolves.toBe(1);
    if (winner.status !== "acquired") throw new Error("missing presentation winner");
    const reservation = await reserveCredits({
      reservationKey: `${winner.operation.operationKey}:html:attempt:0`,
      operationKey: winner.operation.operationKey,
      userId: USER_ID,
      scene: "generate_lesson_html",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, usage(4_000), `${reservation.reservationKey}:usage`, clients[1]);
    const billedBeforeReplay = await clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } });
    const response = { lessonId: LESSON_1, engine: "llm", presentationStatus: "premium" };
    await completeCoursePresentationOperation(winner.operation, response, clients[2]);

    await expect(startCoursePresentationOperation(winnerInput, clients[3]))
      .resolves.toEqual({ status: "replay", response });
    await expect(clients[0].generationJob.count()).resolves.toBe(1);
    await expect(clients[0].creditReservation.count()).resolves.toBe(1);
    await expect(clients[0].llmUsage.count()).resolves.toBe(1);
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: billedBeforeReplay.balance, totalSpent: billedBeforeReplay.totalSpent });
  });

  it("reports a different active presentation without exposing a canonical requestId", async () => {
    const theme = operationInput("request-id-active-theme-0001", "custom_theme");
    const started = await startCoursePresentationOperation(theme, clients[0]);
    expect(started.status).toBe("acquired");
    const lesson = await startCoursePresentationOperation(
      operationInput("request-id-blocked-lesson-1"),
      clients[1],
    );
    expect(lesson).toMatchObject({
      status: "busy",
      activeRequestId: null,
      activeKind: "custom_theme",
      activeTargetLessonIds: [LESSON_1, LESSON_2],
    });
  });

  it("rejects a stale custom-theme snapshot even when the lesson ID set did not change", async () => {
    const lessons = await clients[0].lesson.findMany({
      where: { courseId: COURSE_ID, blocksJson: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, title: true, summary: true, sortOrder: true, blocksJson: true, htmlJson: true,
        renderSourceHash: true, renderEngine: true, designJson: true,
      },
    });
    await clients[0].lesson.update({
      where: { id: LESSON_1 },
      data: { summary: "changed after route snapshot" },
    });
    const input = {
      ...operationInput("request-id-theme-snapshot-1", "custom_theme"),
      targetSnapshotHash: coursePresentationPayloadHash(lessons),
    };

    await expect(startCoursePresentationOperation(input, clients[1])).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].generationJob.count()).resolves.toBe(0);
    await expect(clients[0].creditReservation.count()).resolves.toBe(0);
  });

  it("replays a completed response byte-for-byte without reacquiring or creating billing rows", async () => {
    const input = operationInput("request-id-done-replay-001");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const response = { lessonId: LESSON_1, engine: "llm", presentationStatus: "premium" };
    await completeCoursePresentationOperation(started.operation, response, clients[0]);

    const replay = await startCoursePresentationOperation(input, clients[1]);
    expect(replay).toEqual({ status: "replay", response });
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: started.operation.operationKey } }))
      .resolves.toMatchObject({ status: "done", attempts: 1 });
    await expect(clients[0].creditReservation.count()).resolves.toBe(0);
  });

  it("takes over an expired undelivered operation only to reverse settled spend, then never reopens it", async () => {
    const input = operationInput("request-id-stale-refund-01");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "failed" },
    });
    const reservation = await reserveCredits({
      reservationKey: `${operation.operationKey}:html:attempt:0`,
      operationKey: operation.operationKey,
      userId: USER_ID,
      scene: "generate_lesson_html",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, usage(4_000), `${reservation.reservationKey}:usage`, clients[1]);
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 94, totalSpent: 6 });
    await clients[0].generationJob.update({
      where: { id: operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });

    await expect(startCoursePresentationOperation(input, clients[2])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 100, totalSpent: 0 });
    await expect(clients[0].llmUsage.findUniqueOrThrow({ where: { idempotencyKey: `${reservation.reservationKey}:usage` } }))
      .resolves.toMatchObject({ creditCost: 6, reservationId: reservation.id });
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: operation.lease.jobId } }))
      .resolves.toMatchObject({ status: "failed", attempts: 2 });
    await expect(startCoursePresentationOperation(input, clients[3])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].generationJob.findUniqueOrThrow({ where: { id: operation.lease.jobId } }))
      .resolves.toMatchObject({ attempts: 2 });
  });

  it("recovers a crash after presentation settle as done instead of refunding delivered work", async () => {
    const input = operationInput("request-id-settled-crash-1");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);
    const reservation = await reserveCredits({
      reservationKey: `${operation.operationKey}:html:attempt:0`,
      operationKey: operation.operationKey,
      userId: USER_ID,
      scene: "generate_lesson_html",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, usage(4_000), `${reservation.reservationKey}:usage`, clients[1]);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "ready" },
    });
    await storeValidPresentation();
    await clients[0].generationJob.update({
      where: { id: operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });

    const replay = await startCoursePresentationOperation(input, clients[2]);
    expect(replay).toEqual({
      status: "replay",
      response: { lessonId: LESSON_1, engine: "llm", presentationStatus: "premium" },
    });
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 94, totalSpent: 6 });
    await expect(clients[0].llmBillingOperationReversal.count({ where: { operationKey: operation.operationKey } }))
      .resolves.toBe(0);
  });

  it("reverses every settled lesson when a custom-theme operation only partially delivers", async () => {
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { customThemeId: "theme-before" },
    });
    await clients[0].lesson.update({ where: { id: LESSON_1 }, data: { designJson: "prior-design-one" } });
    await clients[0].lesson.update({ where: { id: LESSON_2 }, data: { designJson: "prior-design-two" } });
    const input = operationInput("request-id-theme-partial-01", "custom_theme");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    let operation = await recordCoursePresentationDesignSnapshot(started.operation, {
      priorCustomThemeId: "theme-before",
      priorLessonDesigns: [
        { lessonId: LESSON_1, designJson: "prior-design-one" },
        { lessonId: LESSON_2, designJson: "prior-design-two" },
      ],
    }, clients[0]);
    operation = await recordCoursePresentationRevision(operation, 1, clients[0]);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "failed", customThemeId: "theme-1" },
    });
    await clients[0].lesson.update({ where: { id: LESSON_1 }, data: { designJson: "new-design-one" } });
    await clients[0].lesson.update({ where: { id: LESSON_2 }, data: { designJson: "new-design-two" } });
    for (const [index, lessonId] of [LESSON_1, LESSON_2].entries()) {
      const reservation = await reserveCredits({
        reservationKey: `${operation.operationKey}:${lessonId}:attempt:0`,
        operationKey: operation.operationKey,
        userId: USER_ID,
        scene: "generate_lesson_html",
        estimatedCredits: 10,
      }, clients[index]);
      await settleLlmUsage(reservation.id, usage(2_000), `${reservation.reservationKey}:usage`, clients[index + 1]);
    }
    await storeValidPresentation({ [LESSON_1]: "llm", [LESSON_2]: "deterministic" });
    await clients[0].generationJob.update({
      where: { id: operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });

    await expect(startCoursePresentationOperation(input, clients[3])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].creditReservation.findMany({ where: { operationKey: operation.operationKey } }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "reversed" }),
        expect.objectContaining({ status: "reversed" }),
      ]));
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 100, totalSpent: 0 });
    await expect(clients[0].llmUsage.count()).resolves.toBe(2);
    await expect(clients[0].creditLedger.count({ where: { type: "llm_operation_refund" } })).resolves.toBe(2);
    await expect(clients[0].lesson.findMany({
      where: { courseId: COURSE_ID },
      orderBy: { sortOrder: "asc" },
      select: { htmlJson: true, renderEngine: true, renderSourceHash: true, designJson: true },
    })).resolves.toEqual([
      { htmlJson: null, renderEngine: null, renderSourceHash: null, designJson: "prior-design-one" },
      { htmlJson: null, renderEngine: null, renderSourceHash: null, designJson: "prior-design-two" },
    ]);
    await expect(clients[0].course.findUniqueOrThrow({ where: { id: COURSE_ID } }))
      .resolves.toMatchObject({ genStatus: "failed", customThemeId: "theme-before", premiumRenderCount: 0 });
  });

  it("never lets a stale fencing token clean artifacts or reverse the takeover winner", async () => {
    const input = operationInput("request-id-stale-token-0001");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);
    await clients[0].generationJob.update({
      where: { id: operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });
    const takeover = await acquireGenerationJobLease({
      userId: USER_ID,
      type: "course_presentation",
      businessKey: operation.stored.businessKey,
      resultRef: COURSE_ID,
      preserveExistingInputJson: true,
    }, clients[1]);
    expect(takeover?.fencingToken).toBe(operation.lease.fencingToken + 1);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "ready" },
    });
    await storeValidPresentation();

    await expect(reconcileCoursePresentationOperationFailure(operation, clients[2]))
      .rejects.toMatchObject({ name: "GenerationJobLeaseLostError" });
    await expect(clients[0].llmBillingOperationReversal.count({
      where: { operationKey: operation.operationKey },
    })).resolves.toBe(0);
    await expect(clients[0].lesson.count({ where: { courseId: COURSE_ID, htmlJson: { not: null } } }))
      .resolves.toBe(2);
  });

  it("keeps a newer presentation revision intact while reversing an expired older operation", async () => {
    const input = operationInput("request-id-newer-revision-01");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);
    const reservation = await reserveCredits({
      reservationKey: `${operation.operationKey}:attempt:0`,
      operationKey: operation.operationKey,
      userId: USER_ID,
      scene: "generate_lesson_html",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, usage(2_000), `${reservation.reservationKey}:usage`, clients[1]);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 2, genStatus: "ready" },
    });
    await storeValidPresentation();
    const winnerHtml = await clients[0].lesson.findMany({
      where: { courseId: COURSE_ID },
      orderBy: { sortOrder: "asc" },
      select: { htmlJson: true, renderSourceHash: true, renderEngine: true },
    });
    await clients[0].generationJob.update({ where: { id: operation.lease.jobId }, data: { leaseUntil: new Date(0) } });

    await expect(startCoursePresentationOperation(input, clients[2])).resolves.toEqual({ status: "failed" });
    await expect(clients[0].lesson.findMany({
      where: { courseId: COURSE_ID },
      orderBy: { sortOrder: "asc" },
      select: { htmlJson: true, renderSourceHash: true, renderEngine: true },
    })).resolves.toEqual(winnerHtml);
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 100, totalSpent: 0 });
  });

  it("counts delivered custom-theme usage once during crash recovery and blocks live theme mutation", async () => {
    const input = operationInput("request-id-theme-recovery-1", "custom_theme");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);

    await expect(clients[1].$transaction(async (tx) => {
      await assertThemeHasNoLivePresentationOperation(tx, "theme-1");
      await tx.theme.delete({ where: { id: "theme-1" } });
    })).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].theme.count({ where: { id: "theme-1" } })).resolves.toBe(1);

    await clients[0].generationJob.update({
      where: { id: operation.lease.jobId },
      data: { leaseUntil: new Date(0) },
    });
    await expect(clients[1].$transaction(async (tx) => {
      await assertThemeHasNoLivePresentationOperation(tx, "theme-1");
    })).rejects.toMatchObject({ status: 409 });

    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "ready", customThemeId: "theme-1" },
    });
    await storeValidPresentation();

    await expect(startCoursePresentationOperation(input, clients[2])).resolves.toMatchObject({
      status: "replay",
      response: { themeId: "theme-1", presentationStatus: "premium" },
    });
    await expect(clients[0].theme.findUniqueOrThrow({ where: { id: "theme-1" } }))
      .resolves.toMatchObject({ usageCount: 1 });
    await expect(startCoursePresentationOperation(input, clients[3])).resolves.toMatchObject({ status: "replay" });
    await expect(clients[0].theme.findUniqueOrThrow({ where: { id: "theme-1" } }))
      .resolves.toMatchObject({ usageCount: 1 });
  });

  it("makes direct theme usage retries exactly-once", async () => {
    const input = operationInput("request-id-theme-count-once", "custom_theme");
    const started = await startCoursePresentationOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const operation = await recordCoursePresentationRevision(started.operation, 1, clients[0]);
    await clients[0].course.update({
      where: { id: COURSE_ID },
      data: { presentationRevision: 1, genStatus: "ready", customThemeId: "theme-1" },
    });
    const [left, right] = await Promise.all([
      recordCoursePresentationThemeUsage(operation, clients[0]),
      recordCoursePresentationThemeUsage(operation, clients[1]),
    ]);
    expect(left.stored.themeUsageCounted).toBe(true);
    expect(right.stored.themeUsageCounted).toBe(true);
    await expect(clients[0].theme.findUniqueOrThrow({ where: { id: "theme-1" } }))
      .resolves.toMatchObject({ usageCount: 1 });
  });
});
