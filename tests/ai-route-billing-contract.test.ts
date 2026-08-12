import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const billingRoutes = [
  "src/app/api/ai/companion/route.ts",
  "src/app/api/ai/note-summary/route.ts",
  "src/app/api/ai/review-card/route.ts",
  "src/app/api/ai/note-transform/route.ts",
  "src/app/api/ai/generate-exam/route.ts",
  "src/app/api/exams/[id]/submit/route.ts",
] as const;

function source(path: (typeof billingRoutes)[number]): string {
  return readFileSync(`${repoRoot}/${path}`, "utf8");
}

describe("AI route durable billing contract", () => {
  it.each(billingRoutes)("%s uses billing without legacy onUsage charging", (path) => {
    const text = source(path);
    expect(text).toContain("billing: {");
    expect(text).toContain("callKey:");
    expect(text).not.toContain("creditingOnUsage");
    expect(text).not.toMatch(/onUsage\s*:/);
  });

  it("uses request entropy for one-shot calls and persistent ids plus loop indexes for repeated calls", () => {
    expect(source("src/app/api/ai/companion/route.ts"))
      .toContain('callKey: `companion:${thread?.id ?? "new"}:${randomUUID()}`');
    expect(source("src/app/api/ai/note-summary/route.ts")).toMatch(
      /callKey: `note-summary:\$\{user\.id\}:\$\{mode\}:\$\{randomUUID\(\)\}`/,
    );
    expect(source("src/app/api/ai/review-card/route.ts")).toMatch(
      /callKey: `review-card:\$\{user\.id\}:batch:\$\{randomUUID\(\)\}`/,
    );
    expect(source("src/app/api/ai/note-transform/route.ts")).toMatch(
      /callKey: `note-transform:\$\{user\.id\}:\$\{action\}:\$\{randomUUID\(\)\}`/,
    );

    const examGeneration = source("src/app/api/ai/generate-exam/route.ts");
    expect(examGeneration).toContain("const billingRequestId = randomUUID();");
    expect(examGeneration).toContain("${billingRequestId}:attempt:${attempt}");

    const examSubmission = source("src/app/api/exams/[id]/submit/route.ts");
    expect(examSubmission).toContain("shortToGrade.entries()");
    expect(examSubmission).toContain("${exam.id}:${billingRequestId}:short-grade:${gradeIndex}:${q.id}");
  });

  it("does not swallow reservation 402 errors in generation or grading fallbacks", () => {
    for (const path of [
      "src/app/api/ai/generate-exam/route.ts",
      "src/app/api/exams/[id]/submit/route.ts",
    ] as const) {
      const text = source(path);
      expect(text).toContain("error instanceof AppError && error.status === 402");
      expect(text).toContain("throw error");
    }
  });
});
