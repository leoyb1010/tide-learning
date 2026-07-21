import { describe, expect, it } from "vitest";
import { lessonTargetsFromBlocks, validateBlocks } from "@/lib/blocks";

describe("branching blocks", () => {
  it("normalizes choice, branch, hotspot and quiz targets", () => {
    const blocks = validateBlocks([
      { type: "quiz", question: "去哪？", options: ["A", "B"], answerIndex: 0, explain: "", branchTargets: ["lesson_a", "javascript:bad"] },
      { type: "choice", prompt: "选路径", choices: [{ label: "基础", targetLessonId: "lesson_b" }, { label: "进阶", feedback: "继续" }] },
      { type: "branch", prompt: "分支", options: [{ label: "一", targetLessonId: "lesson_b" }, { label: "二", targetLessonId: "lesson_c", condition: "已完成" }] },
      { type: "hotspot", imageSrc: "/lesson-stills/lesson-still-ai.jpg", spots: [{ x: 120, y: -2, label: "点", targetLessonId: "lesson_c" }] },
    ]);
    expect(blocks.map((block) => block.type)).toEqual(["quiz", "choice", "branch", "hotspot"]);
    expect(lessonTargetsFromBlocks(blocks).sort()).toEqual(["lesson_a", "lesson_b", "lesson_c"]);
    const hotspot = blocks[3];
    expect(hotspot.type === "hotspot" && hotspot.spots[0]).toMatchObject({ x: 100, y: 0 });
  });
});
