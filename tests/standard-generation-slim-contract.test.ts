import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/course-gen.ts", "utf8");

describe("standard course generation slim contract", () => {
  it("keeps standard authoring to at most two protocol attempts and skips realtime agents", () => {
    expect(source).toContain("const maxAuthorPasses = deep ? 3 : 2");
    expect(source).toContain("const narrativePlan = deep");
    expect(source).toContain("if (!deep || (candidateQuality.passed");
    expect(source).toContain("const candidateJudge = deep && candidateQuality.passed");
  });

  it("uses deterministic course review and deterministic HTML for standard tier", () => {
    expect(source).toContain('course.qualityTier === "premium"');
    expect(source).toContain('course.qualityTier !== "premium"');
    expect(source).toContain('const creativeEnabled = Boolean(course.authorUserId) && course.qualityTier === "premium"');
  });
});
