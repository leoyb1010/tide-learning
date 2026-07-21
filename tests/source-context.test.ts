import { describe, expect, it } from "vitest";
import { courseOutlinePrompt, selectRelevantSourceText } from "@/lib/ai/prompts";

describe("逐节资料检索", () => {
  const section = (title: string, word: string) => `# ${title}\n${word.repeat(900)}\n\n`;
  const source =
    section("需求发现", "访谈观察") +
    section("方案判断", "取舍证据") +
    section("上线复盘", "指标偏差") +
    section("组织推广", "协作机制");

  it("按当前节主题选择相关片段，不再所有章节只吃资料开头", () => {
    const picked = selectRelevantSourceText(
      source,
      { query: "上线后的指标偏差与复盘", lessonIndex: 2, lessonCount: 4 },
      2200,
    );
    expect(picked).toContain("指标偏差");
    expect(picked.indexOf("指标偏差")).toBeLessThan(picked.length);
  });

  it("课程大纲不再注入固定三段式或固定 5-8 节", () => {
    const prompt = courseOutlinePrompt({
      prompt: "学习访谈追问",
      category: "ai_skill",
      lessonRange: { min: 3, target: 6, max: 10 },
    });
    expect(prompt.system).not.toContain("轻松入门、建立信心");
    expect(prompt.user).toContain("可在 3-10 节内按内容调整");
    expect(prompt.user).not.toContain("5-8 节");
  });
});
