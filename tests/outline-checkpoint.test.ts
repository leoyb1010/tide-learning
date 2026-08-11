import { describe, expect, it } from "vitest";
import { checkpointPatchLessons } from "@/lib/outline-checkpoint";

describe("大纲检查点 round-trip", () => {
  it("未编辑直接确认时逐字保留学习目标", () => {
    const payload = checkpointPatchLessons([
      { id: "lesson_1", title: "  第一节  ", summary: "能独立完成 X，并解释为什么" },
    ]);
    expect(payload).toEqual([
      { id: "lesson_1", title: "第一节", summary: "能独立完成 X，并解释为什么" },
    ]);
  });

  it("只有用户明确清空目标时才发送空串", () => {
    expect(checkpointPatchLessons([{ id: "lesson_1", title: "第一节", summary: "" }])[0]?.summary).toBe("");
  });
});
