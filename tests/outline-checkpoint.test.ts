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

  it("不知道目标值时省略字段，不把 undefined/null 冒充用户清空", () => {
    expect(checkpointPatchLessons([{ id: "lesson_1", title: "第一节" }])[0]).not.toHaveProperty("summary");
    expect(checkpointPatchLessons([{ id: "lesson_1", title: "第一节", summary: null }])[0]).not.toHaveProperty("summary");
  });

  it("拒绝重复章节 id，避免同一行被覆盖两次", () => {
    expect(() => checkpointPatchLessons([
      { id: "lesson_1", title: "第一版" },
      { id: "lesson_1", title: "第二版" },
    ])).toThrow("重复章节");
  });
});
