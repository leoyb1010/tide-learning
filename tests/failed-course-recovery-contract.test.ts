import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("历史失败标准课程恢复工具", () => {
  it("默认 dry-run，显式 --apply 才写，并复用可靠本地内容与统一 finalizer", () => {
    const source = readFileSync("scripts/recover-failed-standard-courses.mts", "utf8");
    expect(source).toContain('args.includes("--apply")');
    expect(source).toContain('args.includes("--include-premium")');
    expect(source).toContain("process.argv.slice(2)");
    expect(source).toContain("needsTransfer");
    expect(source).toContain('assessmentNeed: index === course.lessons.length - 1 ? "transfer"');
    expect(source).toContain("buildReliableStandardBlocks");
    expect(source).toContain("finalizeCourseGeneration");
    expect(source).toContain("claimCourseGenerationStart");
  });
});
