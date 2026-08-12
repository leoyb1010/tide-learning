import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acquireGenerationJobLease,
  finishGenerationJobLease,
  generationJobDedupeKey,
  renewGenerationJobLease,
  runWithGenerationJobLeaseHeartbeat,
  updateGenerationJobLeaseProgress,
} from "@/lib/generation-job-lease";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260812010000_generation_job_lease_fencing/migration.sql",
);
const t0 = new Date("2026-08-12T00:00:00.000Z");
const clients: PrismaClient[] = [];
let tempDir = "";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-generation-lease-"));
  const dbPath = join(tempDir, "lease.db");
  // 走项目生产迁移入口：Prisma 对完全空 SQLite 偶发无细节 schema-engine error，
  // migrate-deploy.sh 只在空库做受控基线引导，随后仍回到标准 migrate deploy。
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  for (let i = 0; i < 6; i++) {
    clients.push(new PrismaClient({ datasources: { db: { url: datasourceUrl } } }));
  }
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.createMany({
    data: [
      { id: "lease-user-1", nickname: "Lease User One" },
      { id: "lease-user-2", nickname: "Lease User Two" },
    ],
  });
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await clients[0].generationJob.deleteMany();
  await clients[0].user.updateMany({
    where: { id: { in: ["lease-user-1", "lease-user-2"] } },
    data: { deletedAt: null },
  });
});

describe("GenerationJob lease migration", () => {
  it("preserves duplicate historical rows with null protocol fields while enforcing new non-null keys", () => {
    const legacyDb = join(tempDir, "legacy.db");
    const migrationSql = readFileSync(migrationPath, "utf8");
    execFileSync("sqlite3", [legacyDb], {
      input: `
        CREATE TABLE "GenerationJob" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "status" TEXT NOT NULL DEFAULT 'queued'
        );
        INSERT INTO "GenerationJob" ("id", "status") VALUES ('old-1', 'running'), ('old-2', 'running');
        ${migrationSql}
      `,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const preserved = execFileSync(
      "sqlite3",
      [legacyDb, 'SELECT COUNT(*) || ":" || SUM("dedupeKey" IS NULL) FROM "GenerationJob";'],
      { encoding: "utf8" },
    ).trim();
    const uniqueIndex = execFileSync(
      "sqlite3",
      [legacyDb, `SELECT COUNT(*) FROM pragma_index_list('GenerationJob') WHERE name='GenerationJob_dedupeKey_key' AND "unique"=1;`],
      { encoding: "utf8" },
    ).trim();
    expect(preserved).toBe("2:2");
    expect(uniqueIndex).toBe("1");

    execFileSync("sqlite3", [legacyDb, `INSERT INTO "GenerationJob" ("id", "dedupeKey") VALUES ('new-1', 'stable-key');`]);
    const duplicate = spawnSync(
      "sqlite3",
      [legacyDb, `INSERT INTO "GenerationJob" ("id", "dedupeKey") VALUES ('new-2', 'stable-key');`],
      { encoding: "utf8" },
    );
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("UNIQUE constraint failed");
  });
});

describe("GenerationJob lease/fencing protocol on isolated SQLite", () => {
  it("builds a stable collision-safe dedupe key", () => {
    expect(generationJobDedupeKey("course_gen", "course:1"))
      .toBe(generationJobDedupeKey(" course_gen ", " course:1 "));
    expect(generationJobDedupeKey("a:b", "c"))
      .not.toBe(generationJobDedupeKey("a", "b:c"));
  });

  it("注销账户不能在匿名 User 壳上新建或接管任务", async () => {
    await clients[0].user.update({
      where: { id: "lease-user-1" },
      data: { deletedAt: new Date(t0) },
    });

    await expect(acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-after-account-delete",
      resultRef: "course-after-account-delete",
      leaseMs: 60_000,
      now: new Date(t0.getTime() + 1_000),
    }, clients[1])).resolves.toBeNull();
    await expect(clients[0].generationJob.count()).resolves.toBe(0);
  });

  it("allows exactly one winner across concurrent independent SQLite clients", async () => {
    const attempts = clients.map((client) => acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-concurrent",
      resultRef: "course-concurrent",
      inputJson: '{"total":8}',
      leaseMs: 60_000,
      now: t0,
    }, client));

    const results = await Promise.all(attempts);
    const winners = results.filter((lease) => lease !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      dedupeKey: generationJobDedupeKey("course_gen", "course-concurrent"),
      fencingToken: 1,
    });

    const rows = await clients[0].generationJob.findMany({
      where: { dedupeKey: generationJobDedupeKey("course_gen", "course-concurrent") },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "running", attempts: 1, fencingToken: 1 });
  });

  it("renews only the current unexpired token without changing its fence", async () => {
    const lease = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-renew",
      resultRef: "course-renew",
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    expect(lease).not.toBeNull();

    const renewed = await renewGenerationJobLease({
      jobId: lease!.jobId,
      fencingToken: lease!.fencingToken,
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 500),
    }, clients[1]);
    expect(renewed?.fencingToken).toBe(1);
    expect(renewed?.heartbeatAt.getTime()).toBe(t0.getTime() + 500);
    expect(renewed?.leaseUntil.getTime()).toBe(t0.getTime() + 2_500);

    await expect(renewGenerationJobLease({
      jobId: lease!.jobId,
      fencingToken: 999,
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 600),
    }, clients[2])).resolves.toBeNull();
  });

  it("长阶段执行期间周期心跳，第二 worker 不能在原始租期后接管", async () => {
    const lease = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-long-stage",
      resultRef: "course-long-stage",
      leaseMs: 10_000,
    }, clients[0]);
    expect(lease).not.toBeNull();

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let markStageStarted!: () => void;
    const stageStarted = new Promise<void>((resolve) => { markStageStarted = resolve; });
    const running = runWithGenerationJobLeaseHeartbeat(lease!, () => {
      markStageStarted();
      return blocked;
    }, {
      db: clients[0],
      leaseMs: 10_000,
      heartbeatEveryMs: 100,
    });

    await stageStarted;
    const baseline = await clients[1].generationJob.findUniqueOrThrow({ where: { id: lease!.jobId } });
    let assertionError: unknown;
    try {
      // 以 DB 心跳推进作为 barrier，不把全量测试下的事件循环抖动误判为租约丢失。
      // 若删掉定时心跳，此 poll 会确定性超时；有心跳时，则在原始租期
      // baseline.leaseUntil 之后的逻辑时间仍不得接管。
      await expect.poll(async () => {
        const row = await clients[2].generationJob.findUniqueOrThrow({ where: { id: lease!.jobId } });
        return row.heartbeatAt!.getTime() > baseline.heartbeatAt!.getTime()
          && row.leaseUntil!.getTime() > baseline.leaseUntil!.getTime();
      }, { interval: 20, timeout: 3_000 }).toBe(true);

      await expect(acquireGenerationJobLease({
        userId: "lease-user-1",
        type: "course_gen",
        businessKey: "course-long-stage",
        resultRef: "course-long-stage",
        leaseMs: 10_000,
        now: new Date(baseline.leaseUntil!.getTime() + 1),
      }, clients[1])).resolves.toBeNull();
    } catch (error) {
      assertionError = error;
    } finally {
      release();
    }
    await expect(running).resolves.toBeUndefined();
    if (assertionError) throw assertionError;
  });

  it("increments the fence on expired takeover and rejects every stale-owner mutation", async () => {
    const first = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-takeover",
      resultRef: "course-takeover",
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    expect(first?.fencingToken).toBe(1);

    const whileActive = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-takeover",
      resultRef: "course-takeover",
      leaseMs: 1_000,
      now: new Date(t0.getTime() + 999),
    }, clients[1]);
    expect(whileActive).toBeNull();

    const second = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-takeover",
      resultRef: "course-takeover",
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 1_001),
    }, clients[2]);
    expect(second).toMatchObject({ jobId: first!.jobId, fencingToken: 2 });

    await expect(renewGenerationJobLease({
      jobId: first!.jobId,
      fencingToken: first!.fencingToken,
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 1_100),
    }, clients[3])).resolves.toBeNull();
    await expect(finishGenerationJobLease({
      jobId: first!.jobId,
      fencingToken: first!.fencingToken,
      status: "done",
      now: new Date(t0.getTime() + 1_100),
    }, clients[4])).resolves.toBe(false);

    await expect(finishGenerationJobLease({
      jobId: second!.jobId,
      fencingToken: second!.fencingToken,
      status: "done",
      now: new Date(t0.getTime() + 1_100),
    }, clients[5])).resolves.toBe(true);
    const row = await clients[0].generationJob.findUniqueOrThrow({ where: { id: first!.jobId } });
    expect(row).toMatchObject({ status: "done", fencingToken: 2, leaseUntil: null });

    await expect(acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-takeover",
      resultRef: "course-takeover",
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 10_000),
    }, clients[0])).resolves.toBeNull();
  });

  it("atomically fences progress writes and preserves the prior snapshot during recovery takeover", async () => {
    const originalProgress = JSON.stringify({ total: 8, done: 3, failed: 1, currentLessonId: "lesson-4" });
    const first = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-progress-fence",
      resultRef: "course-progress-fence",
      inputJson: originalProgress,
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    expect(first).not.toBeNull();

    const second = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-progress-fence",
      resultRef: "course-progress-fence",
      inputJson: JSON.stringify({ total: 0, done: 0 }),
      preserveExistingInputJson: true,
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 1_001),
    }, clients[1]);
    expect(second?.fencingToken).toBe(2);
    const afterTakeover = await clients[0].generationJob.findUniqueOrThrow({ where: { id: first!.jobId } });
    expect(afterTakeover.inputJson).toBe(originalProgress);

    await expect(updateGenerationJobLeaseProgress({
      jobId: first!.jobId,
      fencingToken: first!.fencingToken,
      inputJson: JSON.stringify({ total: 8, done: 8, failed: 0, currentLessonId: null }),
      leaseMs: 2_000,
      now: new Date(t0.getTime() + 1_100),
    }, clients[2])).resolves.toBeNull();

    const currentProgress = JSON.stringify({ total: 8, done: 4, failed: 1, currentLessonId: null });
    const updated = await updateGenerationJobLeaseProgress({
      jobId: second!.jobId,
      fencingToken: second!.fencingToken,
      inputJson: currentProgress,
      leaseMs: 3_000,
      now: new Date(t0.getTime() + 1_100),
    }, clients[3]);
    expect(updated).toMatchObject({ fencingToken: 2 });
    expect(updated?.leaseUntil.getTime()).toBe(t0.getTime() + 4_100);

    const stored = await clients[0].generationJob.findUniqueOrThrow({ where: { id: first!.jobId } });
    expect(stored.inputJson).toBe(currentProgress);
    expect(stored.fencingToken).toBe(2);
  });

  it("does not let an expired owner revive itself or another user take over the same key", async () => {
    const lease = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-owner-boundary",
      resultRef: "course-owner-boundary",
      leaseMs: 1_000,
      now: t0,
    }, clients[0]);
    const expiredAt = new Date(t0.getTime() + 1_001);

    await expect(renewGenerationJobLease({
      jobId: lease!.jobId,
      fencingToken: lease!.fencingToken,
      leaseMs: 1_000,
      now: expiredAt,
    }, clients[1])).resolves.toBeNull();
    await expect(finishGenerationJobLease({
      jobId: lease!.jobId,
      fencingToken: lease!.fencingToken,
      status: "failed",
      errorMessage: "late worker",
      now: expiredAt,
    }, clients[2])).resolves.toBe(false);
    await expect(acquireGenerationJobLease({
      userId: "lease-user-2",
      type: "course_gen",
      businessKey: "course-owner-boundary",
      resultRef: "course-owner-boundary",
      leaseMs: 1_000,
      now: expiredAt,
    }, clients[3])).resolves.toBeNull();

    const rightfulTakeover = await acquireGenerationJobLease({
      userId: "lease-user-1",
      type: "course_gen",
      businessKey: "course-owner-boundary",
      resultRef: "course-owner-boundary",
      leaseMs: 1_000,
      now: expiredAt,
    }, clients[4]);
    expect(rightfulTakeover?.fencingToken).toBe(2);
  });

  it("只有显式 resume 可重开 done job，普通启动扫描仍不能接管", async () => {
    const lease = await acquireGenerationJobLease({
      userId: "lease-user-1", type: "course_gen", businessKey: "course-manual-edit",
      resultRef: "course-manual-edit", leaseMs: 1_000, now: t0,
    }, clients[0]);
    await finishGenerationJobLease({
      jobId: lease!.jobId, fencingToken: lease!.fencingToken, status: "done",
      now: new Date(t0.getTime() + 100),
    }, clients[0]);

    await expect(acquireGenerationJobLease({
      userId: "lease-user-1", type: "course_gen", businessKey: "course-manual-edit",
      resultRef: "course-manual-edit", leaseMs: 1_000, now: new Date(t0.getTime() + 200),
    }, clients[1])).resolves.toBeNull();

    const reopened = await acquireGenerationJobLease({
      userId: "lease-user-1", type: "course_gen", businessKey: "course-manual-edit",
      resultRef: "course-manual-edit", allowCompletedReopen: true,
      leaseMs: 1_000, now: new Date(t0.getTime() + 200),
    }, clients[2]);
    expect(reopened).toMatchObject({ jobId: lease!.jobId, fencingToken: 2 });
  });
});
