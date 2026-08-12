import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importedSourceFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { importedSource: { findFirst: mocks.importedSourceFindFirst } },
}));

import { resolveCourseSourceTruth } from "@/lib/ai/course-source-truth";

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course_1",
    authorUserId: "user_1",
    origin: "user_imported",
    blueprintJson: null,
    contentBriefJson: JSON.stringify({ v: 1, request: "整理导入资料", sourceBased: true }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importedSourceFindFirst.mockResolvedValue(null);
});

describe("resolveCourseSourceTruth", () => {
  it("扫描完整 ImportedSource，能识别 2000 字之后的可信截至日期", async () => {
    const rawText = `OpenAI API 当前价格资料\n${"正文".repeat(1200)}\n本资料截至 2026-08-12。`;
    expect(rawText.indexOf("2026-08-12")).toBeGreaterThan(2000);
    mocks.importedSourceFindFirst.mockResolvedValue({ rawText });

    const truth = await resolveCourseSourceTruth(course());

    expect(truth.hasActualSource).toBe(true);
    expect(truth.requiresActualSource).toBe(true);
    expect(truth.trustedSourceAsOf).toBe("2026-08-12");
    expect(truth.outlineReferenceText).toContain("2026-08-12");
    expect(mocks.importedSourceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        generatedCourseId: "course_1",
        userId: "user_1",
        parseStatus: "parsed",
        rawText: { not: null },
      }),
    }));
  });

  it("sourceBased 历史标记不能伪造实际来源", async () => {
    const truth = await resolveCourseSourceTruth(course());
    expect(truth.requiresActualSource).toBe(true);
    expect(truth.hasActualSource).toBe(false);
    expect(truth.actualSourceText).toBe("");
  });

  it("蓝图与导入原文同时存在时两者都是实际来源", async () => {
    mocks.importedSourceFindFirst.mockResolvedValue({ rawText: "导入原文" });
    const truth = await resolveCourseSourceTruth(course({
      blueprintJson: JSON.stringify({ referenceText: "用户参考资料" }),
    }));
    expect(truth.actualSourceText).toContain("用户参考资料");
    expect(truth.actualSourceText).toContain("导入原文");
  });
});
