import { beforeEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  estimateCredits: vi.fn(() => 12),
  reserveCredits: vi.fn(),
  settleLlmUsage: vi.fn(),
  refundCreditReservation: vi.fn(),
  refundCreditReservationForReconciliation: vi.fn(),
}));

vi.mock("@/lib/credits", () => billing);
vi.mock("@/lib/ai/models", () => ({
  resolveModel: () => ({ key: "audit-model" }),
  modelCredentials: () => ({ apiKey: "audit-key", baseUrl: "https://llm.audit.invalid/v1" }),
  hasUsableModel: () => true,
  costWeightOf: () => 1,
}));

import { AppError } from "@/lib/errors";
import { chat, isFailClosedLlmError } from "@/lib/llm";

function response(status = 200, content = "课程正文", withUsage = true) {
  return new Response(JSON.stringify(status === 200 ? {
    choices: [{ message: { content }, finish_reason: "stop" }],
    ...(withUsage ? { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } } : {}),
  } : { error: "upstream" }), { status, headers: { "content-type": "application/json" } });
}

const options = {
  system: "system",
  user: "user",
  retries: 0,
  billing: { userId: "user-1", scene: "generate_lesson" as const, callKey: "job-1:fence-1:author:lesson-1:0" },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  billing.reserveCredits.mockImplementation(async ({ reservationKey }: { reservationKey: string }) => ({
    id: `reservation:${reservationKey}`,
    status: "active",
    expiresAt: new Date(Date.now() + 60_000),
    duplicate: false,
  }));
  billing.settleLlmUsage.mockResolvedValue({});
  billing.refundCreditReservation.mockResolvedValue(true);
  billing.refundCreditReservationForReconciliation.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => response()));
});

describe("chat durable billing reservation", () => {
  it.each([
    [new AppError("余额不足", 402), true],
    [new AppError("幂等冲突", 409), true],
    [new AppError("计费结算失败", 503), true],
    [new AppError("不可重试供应商错误", 502, false), true],
    [new AppError("普通可重试供应商错误", 502), false],
    [new Error("模型内容无效"), false],
  ])("classifies upper-layer fail-closed errors", (error, expected) => {
    expect(isFailClosedLlmError(error)).toBe(expected);
  });

  it("reserves before fetch, settles before delivery, and does not refund a successful call", async () => {
    await expect(chat(options)).resolves.toBe("课程正文");
    expect(billing.reserveCredits).toHaveBeenCalledWith(expect.objectContaining({
      reservationKey: `${options.billing.callKey}:attempt:0`, estimatedCredits: 12,
    }));
    expect(billing.reserveCredits.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0],
    );
    expect(billing.settleLlmUsage).toHaveBeenCalledWith(
      `reservation:${options.billing.callKey}:attempt:0`,
      expect.objectContaining({ totalTokens: 150, model: "audit-model" }),
      `${options.billing.callKey}:attempt:0:usage`,
    );
    expect(billing.refundCreditReservation).not.toHaveBeenCalled();
  });

  it("binds every provider attempt to the stable user-visible operation key", async () => {
    await expect(chat({
      ...options,
      billing: { ...options.billing, operationKey: "presentation-operation-1" },
    })).resolves.toBe("课程正文");
    expect(billing.reserveCredits).toHaveBeenCalledWith(expect.objectContaining({
      reservationKey: `${options.billing.callKey}:attempt:0`,
      operationKey: "presentation-operation-1",
    }));
  });

  it("allows only the reservation creator to dispatch a concurrent identical provider call", async () => {
    let reservationCall = 0;
    billing.reserveCredits.mockImplementation(async ({ reservationKey }: { reservationKey: string }) => ({
      id: `reservation:${reservationKey}`,
      status: "active",
      expiresAt: new Date(Date.now() + 60_000),
      duplicate: reservationCall++ > 0,
    }));
    let releaseProvider!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      releaseProvider = () => resolve(response());
    })));

    // 先让 winner 进入供应商调用并挂起，再以同 callKey 重试；
    // 这正是丢包/并发重试的生产窗口。
    const winner = chat(options);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await expect(chat(options)).rejects.toMatchObject({ status: 409, retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
    releaseProvider();
    await expect(winner).resolves.toBe("课程正文");
    expect(billing.settleLlmUsage).toHaveBeenCalledOnce();
  });

  it("uses a UTF-8 byte upper bound for non-BMP prompt reservation", async () => {
    await expect(chat({ ...options, system: "🧠", user: "课程" })).resolves.toBe("课程正文");
    expect(billing.estimateCredits).toHaveBeenCalledWith(
      "generate_lesson",
      Buffer.byteLength("🧠课程", "utf8") + 8000,
      "audit-model",
    );
  });

  it("refunds a failed HTTP attempt and reserves a distinct row before retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response()));
    await expect(chat({ ...options, retries: 1 })).resolves.toBe("课程正文");
    expect(billing.reserveCredits.mock.calls.map(([value]) => value.reservationKey)).toEqual([
      `${options.billing.callKey}:attempt:0`, `${options.billing.callKey}:attempt:1`,
    ]);
    expect(billing.refundCreditReservationForReconciliation).toHaveBeenCalledWith(
      `reservation:${options.billing.callKey}:attempt:0`,
      expect.objectContaining({
        attemptKey: `${options.billing.callKey}:attempt:0`,
        reasonCode: "provider_5xx",
        providerStatus: 500,
      }),
    );
    expect(billing.refundCreditReservation).not.toHaveBeenCalledWith(
      `reservation:${options.billing.callKey}:attempt:0`, "LLM 供应商调用未成功交付",
    );
    expect(billing.settleLlmUsage).toHaveBeenCalledOnce();
  });

  it("stops before a provider retry when reconciliation cannot be durably stored", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    billing.refundCreditReservationForReconciliation.mockRejectedValueOnce(new Error("database unavailable"));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response()));

    await expect(chat({ ...options, retries: 1 })).rejects.toMatchObject({ status: 503, retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
    expect(billing.reserveCredits).toHaveBeenCalledOnce();
    expect(billing.settleLlmUsage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[llm] billing reservation refund failed:", "database unavailable");
  });

  it("settlement failure is fail-closed, refunded, and never retries the successful provider response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    billing.settleLlmUsage.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(chat({ ...options, retries: 1 })).rejects.toMatchObject({ status: 503, retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
    expect(billing.refundCreditReservationForReconciliation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reasonCode: "settlement_failed", usage: expect.objectContaining({ totalTokens: 150 }) }),
    );
    expect(billing.refundCreditReservation).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[llm] billing settlement failed:", "database unavailable");
  });

  it("uses a conservative measured fallback when a successful response omits usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, "正文", false)));
    await expect(chat(options)).resolves.toBe("正文");
    expect(billing.settleLlmUsage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ promptTokens: expect.any(Number), completionTokens: 1, totalTokens: expect.any(Number) }),
      expect.any(String),
    );
  });

  it("charges an empty reasoning response when the provider reports usage before retrying", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "", reasoning_content: "thinking" }, finish_reason: "length" }],
        usage: { prompt_tokens: 80, completion_tokens: 120, total_tokens: 200 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response()));
    await expect(chat({ ...options, retries: 1 })).resolves.toBe("课程正文");
    expect(billing.settleLlmUsage).toHaveBeenCalledTimes(2);
    expect(billing.refundCreditReservation).not.toHaveBeenCalled();
  });

  it("never calls the provider when the pre-reservation is rejected", async () => {
    billing.reserveCredits.mockRejectedValueOnce(Object.assign(new Error("insufficient"), { status: 402 }));
    await expect(chat(options)).rejects.toMatchObject({ status: 402 });
    expect(fetch).not.toHaveBeenCalled();
    expect(billing.settleLlmUsage).not.toHaveBeenCalled();
  });

  it("never calls the provider with an already expired reservation", async () => {
    billing.reserveCredits.mockResolvedValueOnce({
      id: "expired-reservation",
      status: "active",
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(chat(options)).rejects.toMatchObject({ status: 409, retryable: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(billing.settleLlmUsage).not.toHaveBeenCalled();
  });

  it("durably marks an ambiguous timeout before refunding the reservation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }));
    await expect(chat(options)).rejects.toMatchObject({ status: 504 });
    expect(billing.refundCreditReservationForReconciliation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        attemptKey: `${options.billing.callKey}:attempt:0`,
        reasonCode: "provider_timeout",
      }),
    );
    expect(billing.refundCreditReservation).not.toHaveBeenCalled();
  });

  it("backs off and retries a provider 429 when the caller allows one retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": "0" },
      }))
      .mockResolvedValueOnce(response()));
    await expect(chat({ ...options, retries: 1 })).resolves.toBe("课程正文");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(billing.refundCreditReservation).toHaveBeenCalledOnce();
    expect(billing.settleLlmUsage).toHaveBeenCalledOnce();
  });

  it("refunds deterministic upstream 4xx without creating a false reconciliation event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(429)));
    await expect(chat(options)).rejects.toMatchObject({ status: 429 });
    expect(billing.refundCreditReservation).toHaveBeenCalledOnce();
    expect(billing.refundCreditReservationForReconciliation).not.toHaveBeenCalled();
  });
});
