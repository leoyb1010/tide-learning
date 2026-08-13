import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const userId = "courseware-billing-fail-closed-user";
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  NEWAPI_API_KEY: process.env.NEWAPI_API_KEY,
  NEWAPI_BASE_URL: process.env.NEWAPI_BASE_URL,
};
const globalPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaSqlitePragma?: boolean;
};
const priorGlobalPrisma = globalPrisma.prisma;
const priorPragmaFlag = globalPrisma.prismaSqlitePragma;

let tempDir = "";
let prisma: PrismaClient;
let generateLessonCreativeDesign: typeof import("@/lib/ai/courseware-creative-design")["generateLessonCreativeDesign"];
let model: import("@/lib/ai/models").LlmModelEntry;

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-courseware-billing-fail-closed-"));
  const dbPath = join(tempDir, "billing.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  process.env.DATABASE_URL = `file:${dbPath}?connection_limit=1`;
  process.env.NEWAPI_API_KEY = "mock-key";
  process.env.NEWAPI_BASE_URL = "http://mock.invalid/v1";
  delete globalPrisma.prisma;
  delete globalPrisma.prismaSqlitePragma;
  vi.resetModules();

  ({ prisma } = await import("@/lib/db"));
  ({ generateLessonCreativeDesign } = await import("@/lib/ai/courseware-creative-design"));
  const { LLM_MODELS } = await import("@/lib/ai/models");
  model = LLM_MODELS.find((candidate) => candidate.key === "gpt-5.6-sol")!;
  await prisma.$queryRawUnsafe("SELECT 1");
  await prisma.user.create({
    data: {
      id: userId,
      nickname: "Courseware billing fail-closed user",
      creditAccount: {
        create: { balance: 1_000_000_000, totalEarned: 1_000_000_000 },
      },
    },
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  delete globalPrisma.prisma;
  delete globalPrisma.prismaSqlitePragma;
  if (priorGlobalPrisma) globalPrisma.prisma = priorGlobalPrisma;
  if (priorPragmaFlag !== undefined) globalPrisma.prismaSqlitePragma = priorPragmaFlag;
  restoreEnv("DATABASE_URL");
  restoreEnv("NEWAPI_API_KEY");
  restoreEnv("NEWAPI_BASE_URL");
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("courseware upper-layer billing fail-closed contract", () => {
  it("stops creative-design retries after one successful provider response cannot settle", async () => {
    const provider = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 1_000_000_000,
        completion_tokens: 0,
        total_tokens: 1_000_000_000,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "mock-settlement-failure" },
    }));
    vi.stubGlobal("fetch", provider);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(generateLessonCreativeDesign({
      courseTitle: "结算防重试课程",
      lessonTitle: "单次供应商调用",
      blocks: [{ id: "concept-1", type: "concept", title: "目标", markdown: "内容" }],
      userId,
      billingKey: "billing-fail-closed-operation",
      model,
    })).rejects.toMatchObject({ status: 503, retryable: false });

    expect(provider).toHaveBeenCalledOnce();
    await expect(prisma.creditReservation.findMany()).resolves.toEqual([
      expect.objectContaining({ status: "refunded", remainingCredits: 0 }),
    ]);
    await expect(prisma.llmBillingReconciliation.findMany()).resolves.toEqual([
      expect.objectContaining({
        reasonCode: "settlement_failed",
        providerStatus: 200,
        providerRequestId: "mock-settlement-failure",
      }),
    ]);
    await expect(prisma.creditAccount.findUniqueOrThrow({ where: { userId } })).resolves.toMatchObject({
      balance: 1_000_000_000,
      totalSpent: 0,
    });
    expect(log).toHaveBeenCalledWith("[llm] billing settlement failed:", expect.any(String));
  });
});
