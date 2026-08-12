import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { creditingOnUsage } from "@/lib/credits";

const usage = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  model: "deepseek-chat",
};

beforeEach(() => vi.clearAllMocks());

describe("creditingOnUsage durability contract", () => {
  it("returns a promise that settles only after the ledger transaction", async () => {
    let commit!: (cost: number) => void;
    prismaMock.$transaction.mockReturnValue(new Promise<number>((resolve) => { commit = resolve; }));
    let settled = false;

    const result = creditingOnUsage("user-1", "generate_lesson")(usage);
    expect(result).toBeInstanceOf(Promise);
    void Promise.resolve(result).then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    commit(1);
    await expect(result).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("turns a failed zero-charge into an observable rejection after writing AuditLog", async () => {
    const dbError = new Error("database unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.$transaction.mockRejectedValue(dbError);
    prismaMock.auditLog.create.mockResolvedValue({});

    await expect(creditingOnUsage("user-2", "generate_lesson")(usage))
      .rejects.toThrow("LLM usage accounting failed (generate_lesson)");

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operatorId: "user-2",
        action: "llm_spend_failed",
        targetType: "credit",
        targetId: "user-2",
      }),
    });
    expect(log).toHaveBeenCalledWith("[credits] recordLlmSpend failed:", dbError);
  });
});
