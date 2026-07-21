import { describe, expect, it } from "vitest";
import { validateLessonGraph } from "@/lib/lesson-graph";

describe("lesson graph", () => {
  const ids = ["lesson_a", "lesson_b", "lesson_c"];

  it("accepts an acyclic graph with conditional edges", () => {
    const result = validateLessonGraph(ids, [
      { fromLessonId: "lesson_a", toLessonId: "lesson_b", condition: { type: "always" } },
      { fromLessonId: "lesson_a", toLessonId: "lesson_c", label: "答对后", condition: { type: "quiz", blockId: "quiz_1", answerIndex: 1 } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.edges[1].condition).toEqual({ type: "quiz", blockId: "quiz_1", answerIndex: 1 });
  });

  it("rejects cycles, self loops and cross-course targets", () => {
    expect(validateLessonGraph(ids, [
      { fromLessonId: "lesson_a", toLessonId: "lesson_b" },
      { fromLessonId: "lesson_b", toLessonId: "lesson_a" },
    ]).issues.join(" ")).toContain("循环");
    expect(validateLessonGraph(ids, [{ fromLessonId: "lesson_a", toLessonId: "lesson_a" }]).ok).toBe(false);
    expect(validateLessonGraph(ids, [{ fromLessonId: "lesson_a", toLessonId: "foreign" }]).ok).toBe(false);
  });
});
