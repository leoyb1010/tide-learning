import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  destroySession: vi.fn(),
  transaction: vi.fn(),
  attachments: vi.fn(),
  userUpdateMany: vi.fn(),
  generationJobCount: vi.fn(),
  reservationCount: vi.fn(),
  reconciliationCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    noteAttachment: { findMany: mocks.attachments },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return {
    AuthError,
    requireUser: mocks.requireUser,
    verifyPassword: vi.fn(() => true),
    destroySession: mocks.destroySession,
  };
});
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    status = 429;
    retryAfterSec = 1;
  }
  return { RateLimitError, assertRateLimit: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/private-upload", () => ({ attachmentDiskPath: vi.fn(() => null) }));

import { POST } from "@/app/api/account/delete/route";

function request() {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "user_1",
    authProvider: "wechat",
    passwordHash: null,
  });
  mocks.attachments.mockResolvedValue([]);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.generationJobCount.mockResolvedValue(0);
  mocks.reservationCount.mockResolvedValue(0);
  mocks.reconciliationCount.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async (run) => run({
    user: { updateMany: mocks.userUpdateMany },
    generationJob: { count: mocks.generationJobCount },
    creditReservation: { count: mocks.reservationCount },
    llmBillingReconciliation: { count: mocks.reconciliationCount },
  }));
});

describe("账号注销与 AI/账务收敛", () => {
  it.each([
    ["运行中生成任务", "job"],
    ["未结算积分预占", "reservation"],
    ["供应商模糊账务对账", "reconciliation"],
  ])("%s 存在时返回 409，不进入个人数据删除", async (_label, kind) => {
    if (kind === "job") mocks.generationJobCount.mockResolvedValueOnce(1);
    if (kind === "reservation") mocks.reservationCount.mockResolvedValueOnce(1);
    if (kind === "reconciliation") mocks.reconciliationCount.mockResolvedValueOnce(1);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("账务正在收敛");
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("User 写序是事务首个状态动作，且匿名财务壳保留 LlmUsage 对账证据", () => {
    const source = readFileSync("src/app/api/account/delete/route.ts", "utf8");
    expect(source.indexOf("tx.user.updateMany")).toBeLessThan(source.indexOf("tx.generationJob.count"));
    expect(source).not.toContain("tx.llmUsage.deleteMany");
    expect(source).toContain('status: { in: ["active", "settling", "refunding"] }');
  });
});
