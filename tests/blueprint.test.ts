import { describe, it, expect } from "vitest";
import {
  parseBlueprint, readBlueprint, serializeBlueprint, lessonCountForLength,
  blueprintLessonFragment, blueprintOutlineFragment,
} from "@/lib/ai/blueprint";

/**
 * L1 课程蓝图（专业模式）—— 白名单校验、序列化往返、prompt 片段生成。
 */

describe("parseBlueprint —— 白名单校验", () => {
  it("合法枚举保留，非法枚举丢弃", () => {
    const bp = parseBlueprint({ audience: "beginner", tone: "coach", length: "deep", blockPrefs: ["quiz", "diagram"] });
    expect(bp).toEqual({ audience: "beginner", tone: "coach", length: "deep", blockPrefs: ["quiz", "diagram"] });
  });
  it("非法值一律丢弃", () => {
    expect(parseBlueprint({ audience: "hacker", tone: 123, length: "" })).toBeNull();
  });
  it("blockPrefs 去重 + 过滤非法", () => {
    const bp = parseBlueprint({ blockPrefs: ["quiz", "quiz", "bogus", "code"] });
    expect(bp?.blockPrefs).toEqual(["quiz", "code"]);
  });
  it("referenceText 截断到 8000 且 trim", () => {
    const bp = parseBlueprint({ referenceText: "  " + "x".repeat(9000) + "  " });
    expect(bp?.referenceText?.length).toBe(8000);
  });
  it("空对象/非对象 → null", () => {
    expect(parseBlueprint({})).toBeNull();
    expect(parseBlueprint(null)).toBeNull();
    expect(parseBlueprint("nope")).toBeNull();
  });
});

describe("序列化往返 + 脏值兜底", () => {
  it("serialize → read 往返一致", () => {
    const bp = { audience: "some" as const, tone: "interview" as const };
    expect(readBlueprint(serializeBlueprint(bp))).toEqual(bp);
  });
  it("脏 JSON → null", () => {
    expect(readBlueprint("{not json")).toBeNull();
    expect(readBlueprint(null)).toBeNull();
  });
});

describe("lessonCountForLength", () => {
  it("brief=5 / standard=8 / deep=12 / 缺省=8", () => {
    expect(lessonCountForLength("brief")).toBe(5);
    expect(lessonCountForLength("standard")).toBe(8);
    expect(lessonCountForLength("deep")).toBe(12);
    expect(lessonCountForLength(undefined)).toBe(8);
  });
});

describe("prompt 片段", () => {
  it("空蓝图 → 空串", () => {
    expect(blueprintLessonFragment(null)).toBe("");
    expect(blueprintOutlineFragment(null)).toBe("");
  });
  it("逐节片段含受众/口吻/块偏好文案", () => {
    const f = blueprintLessonFragment({ audience: "beginner", tone: "coach", blockPrefs: ["quiz"] });
    expect(f).toContain("零基础");
    expect(f).toContain("私教");
    expect(f).toContain("quiz");
  });
  it("大纲片段含篇幅节数", () => {
    const f = blueprintOutlineFragment({ length: "deep" });
    expect(f).toContain("12");
  });
  it("referenceText 不进逐节片段（另走 grounding 注入）", () => {
    const f = blueprintLessonFragment({ referenceText: "机密素材内容" });
    expect(f).toBe("");
  });
});
