import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/models", () => ({
  resolveModel: () => ({ key: "audit-model" }),
  modelCredentials: () => ({ apiKey: "audit-key", baseUrl: "https://llm.audit.invalid/v1" }),
  hasUsableModel: () => true,
}));

import { chat } from "@/lib/llm";

function successfulResponse() {
  return new Response(JSON.stringify({
    choices: [{ message: { content: "课程正文" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => successfulResponse()));
});

describe("chat usage callback delivery contract", () => {
  it("waits for an async usage callback before returning content", async () => {
    let release!: () => void;
    const ledgerGate = new Promise<void>((resolve) => { release = resolve; });
    const onUsage = vi.fn(async () => ledgerGate);
    let settled = false;

    const result = chat({ system: "system", user: "user", retries: 0, onUsage });
    void result.then(() => { settled = true; });
    await vi.waitFor(() => expect(onUsage).toHaveBeenCalledOnce());
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    release();
    await expect(result).resolves.toBe("课程正文");
    expect(settled).toBe(true);
  });


  it("sends reasoning_effort only when a caller explicitly opts in", async () => {
    await expect(chat({ system: "system", user: "user", retries: 0, reasoningEffort: "low" })).resolves.toBe("课程正文");
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe("low");
  });

  it("observes callback failure without retrying the successful provider response", async () => {
    const onUsage = vi.fn(async () => { throw new Error("ledger unavailable"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(chat({ system: "system", user: "user", retries: 1, onUsage })).resolves.toBe("课程正文");

    expect(fetch).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[llm] usage callback failed:", "ledger unavailable");
  });
});
