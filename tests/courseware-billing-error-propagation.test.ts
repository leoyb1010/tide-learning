import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { LessonCreativeDesign } from "@/lib/ai/courseware-creative-design";
import type { LlmModelEntry } from "@/lib/ai/models";

const mocks = vi.hoisted(() => ({ chatJson: vi.fn() }));

vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, chatJson: mocks.chatJson };
});

import { judgeCoursewareDesign } from "@/lib/ai/courseware-design-judge";

const model: LlmModelEntry = {
  key: "billing-contract-model",
  label: "Billing contract model",
  desc: "test only",
  tier: "free",
  costWeight: 1,
  envKeyName: "BILLING_CONTRACT_TEST_KEY",
  enabled: true,
};

const color = { l: 0.5, c: 0.1, h: 180, hex: "#008080" };
const design: LessonCreativeDesign = {
  v: 1,
  direction: "内容导向的单页叙事",
  palette: {
    background: color,
    surface: color,
    ink: color,
    muted: color,
    accent: color,
    accentInk: color,
  },
  font: "system-sans",
  fontStack: "system-ui, sans-serif",
  radiusPx: 8,
  gridColumns: 8,
  spacingUnit: 8,
  motif: "潮汐节奏",
  layoutStrategy: "由问题到决策的线性路径",
  motion: { durationMs: 300, easing: [0.2, 0, 0, 1], signature: "淡入" },
};

const input = {
  title: "结算契约",
  html: "<!doctype html><html><body>课件</body></html>",
  design,
  userId: "billing-contract-user",
  billingKey: "billing-contract-operation",
  model,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("courseware billing error propagation", () => {
  it("rethrows fail-closed errors from the design judge", async () => {
    mocks.chatJson.mockRejectedValueOnce(new AppError("结算失败", 503, false));

    await expect(judgeCoursewareDesign(input)).rejects.toMatchObject({ status: 503, retryable: false });
    expect(mocks.chatJson).toHaveBeenCalledOnce();
  });

  it("still degrades an ordinary retryable provider failure to an unavailable verdict", async () => {
    mocks.chatJson.mockRejectedValueOnce(new AppError("供应商短暂失败", 502));

    await expect(judgeCoursewareDesign(input)).resolves.toMatchObject({
      passed: false,
      judged: false,
    });
    expect(mocks.chatJson).toHaveBeenCalledOnce();
  });

  it("keeps the private HTML synthesis catch on the shared fail-closed classifier", () => {
    const source = readFileSync("src/lib/ai/courseware-gen.ts", "utf8");
    const synthesis = source.slice(
      source.indexOf("async function synthesizeViaLLM"),
      source.indexOf("/** 后台主链入口"),
    );
    expect(synthesis).toContain("if (isFailClosedLlmError(error)) throw error;");
  });
});
