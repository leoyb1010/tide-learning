import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acquireGenerationJobLease } from "@/lib/generation-job-lease";
import {
  recoverCourseGenerationJobs,
  shouldStartGenerationRecoveryWorker,
} from "@/lib/generation-worker";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const t0 = new Date("2026-08-12T00:00:00.000Z");
const clients: PrismaClient[] = [];
let tempDir = "";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-generation-worker-"));
  const dbPath = join(tempDir, "worker.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  for (let i = 0; i < 4; i++) clients.push(new PrismaClient({ datasources: { db: { url: datasourceUrl } } }));
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: "worker-user", nickname: "Recovery Worker" } });
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clients[0].generationJob.deleteMany();
  await clients[0].lesson.deleteMany();
  await clients[0].course.deleteMany();
});

async function createCourse(id: string, genStatus = "generating", generatedLessons = 0, createdAt?: Date) {
  return clients[0].course.create({
    data: {
      id,
      slug: `slug-${id}`,
      title: `Course ${id}`,
      category: "career",
      level: "L1",
      status: "draft",
      origin: "ai_generated",
      visibility: "private",
      authorUserId: "worker-user",
      genStatus,
      ...(createdAt ? { createdAt } : {}),
      lessons: {
        create: Array.from({ length: 3 }, (_, index) => ({
          id: `${id}-lesson-${index}`,
          title: `Lesson ${index}`,
          sortOrder: index,
          blocksJson: index < generatedLessons ? '{"version":1,"blocks":[]}' : null,
        })),
      },
    },
  });
}

describe("durable course generation recovery worker", () => {
  it("recovers a generating course after process startup even when no job row survived", async () => {
    await createCourse("startup-recovery", "generating", 1);
    const calls: Array<{ courseId: string; userId: string; token: number }> = [];

    const summary = await recoverCourseGenerationJobs({
      db: clients[0],
      now: t0,
      leaseMs: 60_000,
      runner: async (courseId, userId, lease) => {
        calls.push({ courseId, userId, token: lease.fencingToken });
      },
    });

    expect(summary).toEqual({ scanned: 1, acquired: 1, completed: 1, skipped: 0, failed: 0 });
    expect(calls).toEqual([{ courseId: "startup-recovery", userId: "worker-user", token: 1 }]);
    const job = await clients[0].generationJob.findFirstOrThrow({ where: { resultRef: "startup-recovery" } });
    expect(job).toMatchObject({ status: "running", fencingToken: 1, type: "course_gen" });
    expect(JSON.parse(job.inputJson)).toMatchObject({ total: 3, done: 1, failed: 0 });
  });

  it("lets only one of two independent startup scanners run the same course", async () => {
    await createCourse("concurrent-recovery");
    const calls: number[] = [];
    const runner = async (_courseId: string, _userId: string, lease: { fencingToken: number }) => {
      calls.push(lease.fencingToken);
    };

    const [left, right] = await Promise.all([
      recoverCourseGenerationJobs({ db: clients[0], now: t0, leaseMs: 60_000, runner }),
      recoverCourseGenerationJobs({ db: clients[1], now: t0, leaseMs: 60_000, runner }),
    ]);

    expect(left.acquired + right.acquired).toBe(1);
    expect(left.skipped + right.skipped).toBe(1);
    expect(calls).toEqual([1]);
    await expect(clients[0].generationJob.count({ where: { resultRef: "concurrent-recovery" } })).resolves.toBe(1);
  });

  it("takes over only an expired lease, retains progress, and does not invent jobs for idle paused courses", async () => {
    await createCourse("expired-recovery", "generating", 2);
    await createCourse("paused-course", "paused");
    const oldProgress = JSON.stringify({ total: 3, done: 2, failed: 1, currentLessonId: "old-lesson" });
    const oldLease = await acquireGenerationJobLease({
      userId: "worker-user",
      type: "course_gen",
      businessKey: "expired-recovery",
      resultRef: "expired-recovery",
      inputJson: oldProgress,
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    expect(oldLease?.fencingToken).toBe(1);
    const tokens: number[] = [];

    const summary = await recoverCourseGenerationJobs({
      db: clients[2],
      now: new Date(t0.getTime() + 1_001),
      leaseMs: 60_000,
      runner: async (_courseId, _userId, lease) => {
        tokens.push(lease.fencingToken);
      },
    });

    expect(summary.scanned).toBe(2);
    expect(summary.acquired).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(tokens).toEqual([2]);
    const job = await clients[0].generationJob.findUniqueOrThrow({ where: { id: oldLease!.jobId } });
    expect(job.inputJson).toBe(oldProgress);
    expect(job.fencingToken).toBe(2);
    await expect(clients[0].generationJob.count({ where: { resultRef: "paused-course" } })).resolves.toBe(0);
  });

  it("closes the pause kill-window after lease expiry without invoking the paid runner", async () => {
    await createCourse("paused-kill-window", "paused", 1);
    const oldLease = await acquireGenerationJobLease({
      userId: "worker-user",
      type: "course_gen",
      businessKey: "paused-kill-window",
      resultRef: "paused-kill-window",
      inputJson: JSON.stringify({ total: 3, done: 1, currentLessonId: "paused-kill-window-lesson-1" }),
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    expect(oldLease?.fencingToken).toBe(1);
    let ran = false;

    const summary = await recoverCourseGenerationJobs({
      db: clients[1],
      now: new Date(t0.getTime() + 1_001),
      leaseMs: 60_000,
      runner: async () => { ran = true; },
    });

    expect(summary).toMatchObject({ scanned: 1, acquired: 1, completed: 1, skipped: 0, failed: 0 });
    expect(ran).toBe(false);
    const job = await clients[0].generationJob.findUniqueOrThrow({ where: { id: oldLease!.jobId } });
    expect(job).toMatchObject({ status: "paused", fencingToken: 2, leaseUntil: null });
    expect(JSON.parse(job.inputJson)).toMatchObject({ done: 1, currentLessonId: "paused-kill-window-lesson-1" });
  });

  it("skips a live lease instead of applying a JSON heartbeat heuristic", async () => {
    await createCourse("active-recovery");
    await acquireGenerationJobLease({
      userId: "worker-user",
      type: "course_gen",
      businessKey: "active-recovery",
      resultRef: "active-recovery",
      inputJson: JSON.stringify({ heartbeatAt: "broken-but-irrelevant" }),
      leaseMs: 60_000,
      now: t0,
    }, clients[0]);
    let ran = false;

    const summary = await recoverCourseGenerationJobs({
      db: clients[3],
      now: new Date(t0.getTime() + 30_000),
      leaseMs: 60_000,
      runner: async () => { ran = true; },
    });

    expect(summary).toMatchObject({ scanned: 1, acquired: 0, skipped: 1 });
    expect(ran).toBe(false);
  });

  it("paginates past more than scanLimit live leases and still recovers a later expired job", async () => {
    for (let index = 0; index < 3; index++) {
      const courseId = `active-front-${index}`;
      await createCourse(courseId, "generating", 0, new Date(t0.getTime() + index));
      await acquireGenerationJobLease({
        userId: "worker-user",
        type: "course_gen",
        businessKey: courseId,
        resultRef: courseId,
        inputJson: "{}",
        leaseMs: 60_000,
        now: t0,
      }, clients[0]);
    }
    await createCourse("expired-behind-window", "generating", 0, new Date(t0.getTime() + 10));
    await acquireGenerationJobLease({
      userId: "worker-user",
      type: "course_gen",
      businessKey: "expired-behind-window",
      resultRef: "expired-behind-window",
      inputJson: "{}",
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    const recovered: string[] = [];

    const summary = await recoverCourseGenerationJobs({
      db: clients[1],
      now: new Date(t0.getTime() + 2_000),
      leaseMs: 60_000,
      limit: 1,
      scanLimit: 2,
      concurrency: 1,
      runner: async (courseId) => { recovered.push(courseId); },
    });

    expect(summary).toMatchObject({ scanned: 4, acquired: 1, completed: 1, skipped: 3, failed: 0 });
    expect(recovered).toEqual(["expired-behind-window"]);
  });

  it("isolates reservation-sweep failure so recovery scanning still runs", async () => {
    await createCourse("sweep-isolated");
    const errors: unknown[] = [];
    let ran = false;

    const summary = await recoverCourseGenerationJobs({
      db: clients[0],
      now: t0,
      leaseMs: 60_000,
      sweepExpiredReservations: async () => { throw new Error("sweep unavailable"); },
      sweepExpiredPresentationOperations: async () => 0,
      sweepExpiredOutlineOperations: async () => 0,
      sweepExpiredImportOperations: async () => 0,
      onError: (error) => { errors.push(error); },
      runner: async () => { ran = true; },
    });

    expect(errors).toHaveLength(1);
    expect(ran).toBe(true);
    expect(summary).toMatchObject({ acquired: 1, completed: 1, failed: 0 });
  });

  it("runs presentation, outline and import reconciliation even when no course-generation candidate exists", async () => {
    let presentationSwept = 0;
    let outlineSwept = 0;
    let importSwept = 0;
    const summary = await recoverCourseGenerationJobs({
      db: clients[0],
      now: t0,
      sweepExpiredReservations: async () => 0,
      sweepExpiredPresentationOperations: async () => { presentationSwept += 1; return 1; },
      sweepExpiredOutlineOperations: async () => { outlineSwept += 1; return 1; },
      sweepExpiredImportOperations: async () => { importSwept += 1; return 1; },
      runner: async () => { throw new Error("must not run"); },
    });

    expect(presentationSwept).toBe(1);
    expect(outlineSwept).toBe(1);
    expect(importSwept).toBe(1);
    expect(summary).toEqual({ scanned: 0, acquired: 0, completed: 0, skipped: 0, failed: 0 });
  });
});

describe("generation recovery startup policy", () => {
  it("defaults on only for production Node SQLite and supports an explicit kill switch", () => {
    expect(shouldStartGenerationRecoveryWorker({
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      DATABASE_URL: "file:/var/lib/tide/prod.db",
    })).toBe(true);
    expect(shouldStartGenerationRecoveryWorker({
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      DATABASE_URL: "file:/var/lib/tide/prod.db",
      GENERATION_WORKER_ENABLED: "0",
    })).toBe(false);
    expect(shouldStartGenerationRecoveryWorker({
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      DATABASE_URL: "postgresql://db/tide",
      GENERATION_WORKER_ENABLED: "1",
    })).toBe(false);
  });
});
