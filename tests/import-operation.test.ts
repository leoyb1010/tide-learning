import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  completeImportOperation,
  importContentSha256,
  importPayloadHash,
  inspectImportOperation,
  reconcileImportOperationFailure,
  reconcileExpiredImportOperations,
  startImportOperation,
} from "@/lib/import-operation";
import { reserveCredits, settleLlmUsage } from "@/lib/credits";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const clients: PrismaClient[] = [];
let tempDir = "";
const USER_ID = "import-operation-user";

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-import-operation-"));
  const dbPath = join(tempDir, "import.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
  const url = `file:${dbPath}?connection_limit=1`;
  for (let index = 0; index < 4; index++) clients.push(new PrismaClient({ datasources: { db: { url } } }));
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: USER_ID, nickname: "Import operation user" } });
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
  await clients[0].importedSource.deleteMany();
  await clients[0].lesson.deleteMany();
  await clients[0].course.deleteMany();
  await clients[0].asset.deleteMany();
  await clients[0].creditAccount.upsert({
    where: { userId: USER_ID },
    create: { userId: USER_ID, balance: 100, totalEarned: 100 },
    update: { balance: 100, totalEarned: 100, totalSpent: 0 },
  });
});

function operationInput(requestId: string, content = "导入资料正文") {
  return {
    userId: USER_ID,
    requestId,
    payloadHash: importPayloadHash({
      scope: "paste",
      contentSha256: importContentSha256(content),
      title: "资料课",
      checkpoint: false,
    }),
  };
}

describe("durable import requestId protocol", () => {
  it("并发请求只有一个 owner，同 requestId 变更内容必须拒绝", async () => {
    const input = operationInput("import-concurrent-request-001");
    const results = await Promise.all(clients.slice(0, 3).map((client) => startImportOperation(input, client)));
    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "running")).toHaveLength(2);
    await expect(startImportOperation(operationInput(input.requestId, "另一份资料"), clients[3]))
      .rejects.toMatchObject({ status: 409 });
    await expect(clients[0].generationJob.count({ where: { type: "import_structure" } })).resolves.toBe(1);
  });

  it("Course/ImportedSource/Lesson 和 done 回放快照在同一事务提交", async () => {
    const input = operationInput("import-atomic-response-0001");
    const started = await startImportOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const response = await clients[0].$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          id: "import-atomic-course",
          slug: "import-atomic-course",
          title: "资料课",
          category: "user_imported",
          level: "L1",
          status: "published",
          origin: "user_imported",
          visibility: "private",
          authorUserId: USER_ID,
          genStatus: "generating",
        },
      });
      const source = await tx.importedSource.create({
        data: { userId: USER_ID, kind: "paste_text", rawText: "导入资料正文", charCount: 8, parseStatus: "parsed", generatedCourseId: course.id },
      });
      const lesson = await tx.lesson.create({
        data: { id: "import-atomic-lesson", courseId: course.id, title: "第一节", sortOrder: 0, status: "published" },
      });
      const snapshot = {
        courseId: course.id,
        slug: course.slug,
        title: course.title,
        charCount: source.charCount,
        lessons: [{ id: lesson.id, title: lesson.title, summary: lesson.summary }],
      };
      await completeImportOperation(tx, started.operation, course.id, snapshot);
      return snapshot;
    });
    await expect(inspectImportOperation(input, clients[1])).resolves.toEqual({ status: "replay", response });
    await expect(clients[0].course.count()).resolves.toBe(1);
    await expect(clients[0].importedSource.count()).resolves.toBe(1);
    await expect(clients[0].lesson.count()).resolves.toBe(1);
  });

  it("失败操作先冲正再冻结，且不能被旧 fencing owner 重复结算", async () => {
    const input = operationInput("import-failure-reversal-001");
    const started = await startImportOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    await expect(reconcileImportOperationFailure(started.operation, "supplier failed", clients[0]))
      .resolves.toEqual({ status: "failed" });
    await expect(reconcileImportOperationFailure(started.operation, "duplicate", clients[1]))
      .rejects.toMatchObject({ name: "GenerationJobLeaseLostError" });
    await expect(inspectImportOperation(input, clients[2])).resolves.toEqual({ status: "failed" });
  });

  it("进程在供应商结算后崩溃，过期 recovery 只冲正一次且不重跑导入", async () => {
    const input = operationInput("import-expired-settled-001");
    const started = await startImportOperation(input, clients[0]);
    expect(started.status).toBe("acquired");
    if (started.status !== "acquired") return;
    const reservation = await reserveCredits({
      reservationKey: `${started.operation.operationKey}:outline`,
      operationKey: started.operation.operationKey,
      userId: USER_ID,
      scene: "import_source",
      estimatedCredits: 10,
    }, clients[0]);
    await settleLlmUsage(reservation.id, {
      promptTokens: 1_000,
      completionTokens: 3_000,
      totalTokens: 4_000,
      model: "deepseek-chat",
    }, `${reservation.reservationKey}:usage`, clients[1]);
    await clients[0].generationJob.update({ where: { id: started.operation.lease.jobId }, data: { leaseUntil: new Date(0) } });
    await expect(reconcileExpiredImportOperations(20, clients[2])).resolves.toBe(1);
    await expect(clients[0].creditAccount.findUniqueOrThrow({ where: { userId: USER_ID } }))
      .resolves.toMatchObject({ balance: 100, totalSpent: 0 });
    await expect(clients[0].llmBillingOperationReversal.count({ where: { operationKey: started.operation.operationKey } }))
      .resolves.toBe(1);
    await expect(reconcileExpiredImportOperations(20, clients[3])).resolves.toBe(0);
    await expect(clients[0].creditLedger.count({ where: { type: "llm_operation_refund" } })).resolves.toBe(1);
  });
});
