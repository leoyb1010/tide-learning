import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  refundCreditReservation,
  refundCreditReservationForReconciliation,
  releaseExpiredCreditReservations,
  reserveCredits,
  reverseCreditOperation,
  settleLlmUsage,
} from "@/lib/credits";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const now = new Date("2026-08-12T03:00:00.000Z");
const clients: PrismaClient[] = [];
let tempDir = "";

const usage = (totalTokens: number) => ({
  promptTokens: Math.floor(totalTokens / 3),
  completionTokens: totalTokens - Math.floor(totalTokens / 3),
  totalTokens,
  model: "deepseek-chat",
});

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "tide-credit-reservation-"));
  const dbPath = join(tempDir, "credits.db");
  execFileSync("bash", ["scripts/migrate-deploy.sh"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });

  const datasourceUrl = `file:${dbPath}?connection_limit=1`;
  for (let i = 0; i < 4; i++) {
    clients.push(new PrismaClient({ datasources: { db: { url: datasourceUrl } } }));
  }
  await clients[0].$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await Promise.all(clients.map((client) => client.$queryRawUnsafe("PRAGMA busy_timeout=10000;")));
  await clients[0].user.create({ data: { id: "credit-reservation-user", nickname: "Credit Reservation User" } });
  await clients[0].user.create({ data: { id: "credit-reservation-other", nickname: "Other Credit User" } });
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
  await clients[0].user.updateMany({
    where: { id: { in: ["credit-reservation-user", "credit-reservation-other"] } },
    data: { deletedAt: null },
  });
  await clients[0].creditAccount.upsert({
    where: { userId: "credit-reservation-user" },
    create: { userId: "credit-reservation-user", balance: 10, totalEarned: 10 },
    update: { balance: 10, totalEarned: 10, totalSpent: 0 },
  });
  await clients[0].creditAccount.upsert({
    where: { userId: "credit-reservation-other" },
    create: { userId: "credit-reservation-other", balance: 10, totalEarned: 10 },
    update: { balance: 10, totalEarned: 10, totalSpent: 0 },
  });
});

describe("durable credit reservation on isolated SQLite", () => {
  it("fails closed before any hold when the account owner is already deleted", async () => {
    await clients[0].user.update({
      where: { id: "credit-reservation-user" },
      data: { deletedAt: new Date(now.getTime() - 1_000) },
    });

    await expect(reserveCredits({
      reservationKey: "course:deleted-user:attempt-0",
      operationKey: "operation:deleted-user",
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 8,
      now,
    }, clients[0])).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].creditReservation.count()).resolves.toBe(0);
    await expect(clients[0].creditLedger.count()).resolves.toBe(0);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
  });

  it("migrates historical reservations without fabricating an operation or reversal", () => {
    const legacyDb = join(tempDir, "operation-reversal-legacy.db");
    const migration = readFileSync(join(
      repoRoot,
      "prisma/migrations/20260812060000_llm_operation_reversal/migration.sql",
    ), "utf8");
    execFileSync("sqlite3", [legacyDb], {
      input: `
        CREATE TABLE "CreditReservation" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "reservationKey" TEXT NOT NULL,
          "status" TEXT NOT NULL
        );
        INSERT INTO "CreditReservation" ("id", "reservationKey", "status")
        VALUES ('legacy-reservation', 'legacy-key', 'settled');
        ${migration}
      `,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = execFileSync("sqlite3", [legacyDb,
      `SELECT "id" || ':' || COALESCE("operationKey", 'null') || ':' || COALESCE("reversedAt", 'null') FROM "CreditReservation";`,
    ], { encoding: "utf8" }).trim();
    const table = execFileSync("sqlite3", [legacyDb,
      `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='LlmBillingOperationReversal';`,
    ], { encoding: "utf8" }).trim();
    expect(result).toBe("legacy-reservation:null:null");
    expect(table).toBe("1");
  });

  it("rolls back the reservation row and ledger when the first hold lacks balance", async () => {
    await expect(reserveCredits({
      reservationKey: "course:insufficient:first-attempt",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 11,
      now,
    }, clients[0])).rejects.toMatchObject({ status: 402 });

    await expect(clients[0].creditReservation.count()).resolves.toBe(0);
    await expect(clients[0].creditLedger.count()).resolves.toBe(0);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
  });

  it("allows only one of two independent clients to reserve the same available balance", async () => {
    const results = await Promise.allSettled([
      reserveCredits({
        reservationKey: "course:race:lesson-1",
        userId: "credit-reservation-user",
        scene: "generate_lesson",
        estimatedCredits: 8,
        now,
      }, clients[0]),
      reserveCredits({
        reservationKey: "course:race:lesson-2",
        userId: "credit-reservation-user",
        scene: "generate_lesson",
        estimatedCredits: 8,
        now,
      }, clients[1]),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ status: 402 });

    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 2 });
    await expect(clients[0].creditReservation.count()).resolves.toBe(1);
    await expect(clients[0].creditLedger.count({ where: { type: "llm_reserve" } })).resolves.toBe(1);
  });

  it("treats the same reservationKey and matching parameters as an idempotent retry", async () => {
    const input = {
      reservationKey: "course:idempotent:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson" as const,
      estimatedCredits: 8,
      now,
    };
    const first = await reserveCredits(input, clients[0]);
    const second = await reserveCredits(input, clients[1]);

    expect(second.id).toBe(first.id);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 2 });
    await expect(clients[0].creditLedger.count({ where: { type: "llm_reserve" } })).resolves.toBe(1);
  });

  it("settles actual usage once and refunds every unused reserved credit", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:refund-unused:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      now,
    }, clients[0]);

    const settled = await settleLlmUsage(
      reservation.id,
      usage(3_000),
      "provider-call:refund-unused:1",
      clients[1],
      new Date(now.getTime() + 1_000),
    );
    expect(settled).toMatchObject({
      actualCredits: 3,
      chargedFromReservation: 3,
      additionalCredits: 0,
      refundedCredits: 5,
      balanceAfter: 7,
      duplicate: false,
    });

    const account = await clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    });
    expect(account).toMatchObject({ balance: 7, totalSpent: 3 });
    const row = await clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(row).toMatchObject({ status: "settled", remainingCredits: 0, actualCredits: 3 });
    const ledger = await clients[0].creditLedger.findMany({
      where: { refId: reservation.id },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger.map(({ type, delta }) => ({ type, delta }))).toEqual([
      { type: "llm_reserve", delta: -8 },
      { type: "llm_reserve_refund", delta: 5 },
    ]);
  });

  it("makes concurrent duplicate usage callbacks converge on one charge", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:duplicate-usage:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      now,
    }, clients[0]);
    const settledAt = new Date(now.getTime() + 1_000);
    const [first, second] = await Promise.all([
      settleLlmUsage(reservation.id, usage(3_000), "provider-call:duplicate:1", clients[1], settledAt),
      settleLlmUsage(reservation.id, usage(3_000), "provider-call:duplicate:1", clients[2], settledAt),
    ]);

    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    expect(first.usageId).toBe(second.usageId);
    expect(first.balanceAfter).toBe(7);
    expect(second.balanceAfter).toBe(7);
    await expect(clients[0].llmUsage.count({ where: { idempotencyKey: "provider-call:duplicate:1" } }))
      .resolves.toBe(1);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
      })).resolves.toMatchObject({ balance: 7, totalSpent: 3 });
  });

  it("returns the immutable original balance snapshot when a settled callback is retried later", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:late-duplicate:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      now,
    }, clients[0]);
    const first = await settleLlmUsage(
      reservation.id,
      usage(3_000),
      "provider-call:late-duplicate:1",
      clients[1],
      new Date(now.getTime() + 1_000),
    );
    expect(first.balanceAfter).toBe(7);

    // 首次结算后账户发生新的真实变动；幂等重试的 DTO 仍须复现原结算快照。
    await clients[0].$transaction(async (tx) => {
      const account = await tx.creditAccount.update({
        where: { userId: "credit-reservation-user" },
        data: { balance: { increment: 5 }, totalEarned: { increment: 5 } },
      });
      await tx.creditLedger.create({
        data: {
          userId: "credit-reservation-user",
          delta: 5,
          type: "test_grant",
          refId: "after-settlement",
          balanceAfter: account.balance,
        },
      });
    });

    const duplicate = await settleLlmUsage(
      reservation.id,
      usage(3_000),
      "provider-call:late-duplicate:1",
      clients[2],
      new Date(now.getTime() + 2_000),
    );
    expect(duplicate).toMatchObject({
      usageId: first.usageId,
      balanceAfter: 7,
      duplicate: true,
    });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 12, totalSpent: 3 });
  });

  it("supplements only within the declared cap and never lets balance go negative", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:bounded-extra:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      maxAdditionalCredits: 4,
      now,
    }, clients[0]);

    await expect(settleLlmUsage(
      reservation.id,
      usage(12_000),
      "provider-call:too-expensive:1",
      clients[1],
      new Date(now.getTime() + 1_000),
    )).rejects.toMatchObject({ status: 402 });

    // 预占后只剩 2 分，所需补扣 4 分失败；整笔 settle 回滚，不能把余额扣成负数或写 usage。
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 2, totalSpent: 0 });
    await expect(clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .resolves.toMatchObject({ status: "active", remainingCredits: 8 });
    await expect(clients[0].llmUsage.count()).resolves.toBe(0);

    await expect(refundCreditReservation(
      reservation.id,
      "provider rejected request",
      clients[2],
      new Date(now.getTime() + 2_000),
    )).resolves.toBe(true);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
    await expect(refundCreditReservation(
      reservation.id,
      "duplicate refund",
      clients[3],
      new Date(now.getTime() + 3_000),
    )).resolves.toBe(false);
  });

  it("charges a bounded additional amount when available balance can cover it", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:bounded-extra-success:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 6,
      maxAdditionalCredits: 3,
      now,
    }, clients[0]);

    const settled = await settleLlmUsage(
      reservation.id,
      usage(8_000),
      "provider-call:bounded-extra:1",
      clients[1],
      new Date(now.getTime() + 1_000),
    );
    expect(settled).toMatchObject({
      actualCredits: 8,
      chargedFromReservation: 6,
      additionalCredits: 2,
      refundedCredits: 0,
      balanceAfter: 2,
    });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 2, totalSpent: 8 });
    const ledger = await clients[0].creditLedger.findMany({ where: { refId: reservation.id } });
    expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(-8);
  });

  it("marks a released overdue reservation expired while refunding its full hold", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:expired:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      ttlMs: 1_000,
      now,
    }, clients[0]);

    await expect(releaseExpiredCreditReservations(
      10,
      clients[1],
      new Date(now.getTime() + 1_001),
    )).resolves.toBe(1);
    await expect(clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .resolves.toMatchObject({ status: "expired", remainingCredits: 0 });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
  });

  it("atomically refunds an ambiguous provider attempt and leaves a privacy-minimized reconciliation event", async () => {
    const reservation = await reserveCredits({
      reservationKey: "course:provider-timeout:lesson-1",
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 8,
      now,
    }, clients[0]);

    await expect(refundCreditReservationForReconciliation(
      reservation.id,
      {
        attemptKey: "course:provider-timeout:lesson-1:attempt:0",
        reasonCode: "provider_timeout",
        providerRequestId: "req-audit-123",
      },
      clients[1],
      new Date(now.getTime() + 1_000),
    )).resolves.toBe(true);

    await expect(clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .resolves.toMatchObject({ status: "refunded", remainingCredits: 0 });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
    await expect(clients[0].llmBillingReconciliation.findUniqueOrThrow({
      where: { reservationId: reservation.id },
    })).resolves.toMatchObject({
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      reasonCode: "provider_timeout",
      providerRequestId: "req-audit-123",
      usageJson: null,
      status: "pending",
    });
  });

  it("reverses settled and active reservations once while preserving immutable usage evidence", async () => {
    const operationKey = "presentation-operation:settled-and-active";
    const settledReservation = await reserveCredits({
      reservationKey: `${operationKey}:html:attempt:0`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 6,
      maxAdditionalCredits: 2,
      now,
    }, clients[0]);
    await settleLlmUsage(
      settledReservation.id,
      usage(5_000),
      `${operationKey}:html:attempt:0:usage`,
      clients[1],
      new Date(now.getTime() + 1_000),
    );
    const activeReservation = await reserveCredits({
      reservationKey: `${operationKey}:judge:attempt:0`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 2,
      now: new Date(now.getTime() + 2_000),
    }, clients[2]);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 0, totalSpent: 8 });

    const first = await reverseCreditOperation({
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      reason: "presentation revision lost",
      now: new Date(now.getTime() + 3_000),
    }, clients[3]);
    expect(first).toMatchObject({
      reversedReservations: 2,
      refundedCredits: 10,
      duplicate: false,
      balanceAfter: 10,
    });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
    await expect(clients[0].creditReservation.findMany({
      where: { operationKey }, orderBy: { reservationKey: "asc" },
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: settledReservation.id, status: "reversed", actualCredits: 8, remainingCredits: 0 }),
      expect.objectContaining({ id: activeReservation.id, status: "reversed", actualCredits: 0, remainingCredits: 0 }),
    ]));
    // usage 是供应商真实成本证据，冲正只改用户账，不删原始用量。
    await expect(clients[0].llmUsage.findUniqueOrThrow({
      where: { idempotencyKey: `${operationKey}:html:attempt:0:usage` },
    })).resolves.toMatchObject({ reservationId: settledReservation.id, creditCost: 8, totalTokens: 5_000 });
    const ledger = await clients[0].creditLedger.findMany({
      where: { refId: { in: [settledReservation.id, activeReservation.id] } },
    });
    expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
    expect(ledger.filter((row) => row.type === "llm_operation_refund").map((row) => row.delta).sort((a, b) => a - b))
      .toEqual([2, 8]);

    const duplicate = await reverseCreditOperation({
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      reason: "duplicate response retry must not rewrite audit",
      now: new Date(now.getTime() + 4_000),
    }, clients[1]);
    expect(duplicate).toMatchObject({ reversedReservations: 0, refundedCredits: 0, duplicate: true, balanceAfter: 10 });
    await expect(clients[0].creditLedger.count({ where: { type: "llm_operation_refund" } })).resolves.toBe(2);
  });

  it("keeps timeout-refunded attempts as a no-op while tombstoning every late reservation", async () => {
    const operationKey = "presentation-operation:timeout-refunded";
    const reservation = await reserveCredits({
      reservationKey: `${operationKey}:attempt:0`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 8,
      now,
    }, clients[0]);
    await refundCreditReservationForReconciliation(reservation.id, {
      attemptKey: `${operationKey}:attempt:0`,
      reasonCode: "provider_timeout",
    }, clients[1], new Date(now.getTime() + 1_000));

    const reversed = await reverseCreditOperation({
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      now: new Date(now.getTime() + 2_000),
    }, clients[2]);
    expect(reversed).toMatchObject({ reversedReservations: 0, refundedCredits: 0, duplicate: false, balanceAfter: 10 });
    await expect(clients[0].creditReservation.findUniqueOrThrow({ where: { id: reservation.id } }))
      .resolves.toMatchObject({ status: "refunded", remainingCredits: 0 });
    await expect(reserveCredits({
      reservationKey: `${operationKey}:late:attempt:0`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 1,
      now: new Date(now.getTime() + 3_000),
    }, clients[3])).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
    await expect(clients[0].creditLedger.count()).resolves.toBe(2); // reserve + timeout refund, no second refund
  });

  it("serializes a real reserve/reversal race without a late charge or stranded hold", async () => {
    const operationKey = "presentation-operation:reserve-reverse-race";
    const [reservationResult, reversalResult] = await Promise.allSettled([
      reserveCredits({
        reservationKey: `${operationKey}:attempt:0`,
        operationKey,
        userId: "credit-reservation-user",
        scene: "generate_lesson_html",
        estimatedCredits: 8,
        now,
      }, clients[0]),
      reverseCreditOperation({
        operationKey,
        userId: "credit-reservation-user",
        scene: "generate_lesson_html",
        now,
      }, clients[1]),
    ]);
    expect(reversalResult.status).toBe("fulfilled");
    if (reservationResult.status === "rejected") expect(reservationResult.reason).toMatchObject({ status: 409 });
    const rows = await clients[0].creditReservation.findMany({ where: { operationKey } });
    expect(rows.every((row) => row.status === "reversed")).toBe(true);
    await expect(clients[0].llmBillingOperationReversal.findUniqueOrThrow({ where: { operationKey } }))
      .resolves.toMatchObject({ userId: "credit-reservation-user", scene: "generate_lesson_html" });
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 10, totalSpent: 0 });
    const ledger = await clients[0].creditLedger.findMany({ where: { userId: "credit-reservation-user" } });
    expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
  });

  it("binds an operationKey to one user and one billing scene", async () => {
    const operationKey = "presentation-operation:ownership";
    await reserveCredits({
      reservationKey: `${operationKey}:attempt:0`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson_html",
      estimatedCredits: 2,
      now,
    }, clients[0]);
    await expect(reverseCreditOperation({
      operationKey,
      userId: "credit-reservation-other",
      scene: "generate_lesson_html",
      now: new Date(now.getTime() + 1_000),
    }, clients[1])).rejects.toMatchObject({ status: 409 });
    await expect(reserveCredits({
      reservationKey: `${operationKey}:wrong-scene`,
      operationKey,
      userId: "credit-reservation-user",
      scene: "generate_lesson",
      estimatedCredits: 1,
      now: new Date(now.getTime() + 2_000),
    }, clients[2])).rejects.toMatchObject({ status: 409 });
    await expect(clients[0].llmBillingOperationReversal.count({ where: { operationKey } })).resolves.toBe(0);
    await expect(clients[0].creditAccount.findUniqueOrThrow({
      where: { userId: "credit-reservation-user" },
    })).resolves.toMatchObject({ balance: 8, totalSpent: 0 });
  });
});
