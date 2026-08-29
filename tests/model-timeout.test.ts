import { describe, expect, it } from "vitest";
import { interactiveLlmTimeoutMs, LLM_MODELS, type LlmModelEntry } from "@/lib/ai/models";

function model(latencyTier?: LlmModelEntry["latencyTier"]): LlmModelEntry {
  return {
    key: `test-${latencyTier ?? "fast"}`, label: "test", desc: "test", tier: "free",
    costWeight: 1, envKeyName: "TEST_MODEL_KEY", enabled: true, latencyTier,
  };
}

describe("interactive LLM timeout budget", () => {
  it("keeps fast calls at 60s and gives slow/reasoning models a proxy-safe 90s", () => {
    expect(interactiveLlmTimeoutMs(model())).toBe(60_000);
    expect(interactiveLlmTimeoutMs(model("fast"))).toBe(60_000);
    expect(interactiveLlmTimeoutMs(model("slow"))).toBe(90_000);
    expect(interactiveLlmTimeoutMs(model("reasoning"))).toBe(90_000);
  });

  it("keeps gpt-5.6-sol interactive structure generation on low reasoning", () => {
    expect(LLM_MODELS.find((entry) => entry.key === "gpt-5.6-sol")?.interactiveReasoningEffort).toBe("low");
  });
});
