import { describe, expect, it } from "vitest";
import { courseOutlinePrompt, selectImportOutlineSourceText, selectRelevantSourceText } from "@/lib/ai/prompts";

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

  it("长文件大纲取样保留文末更正，不再静默只看前 50k", () => {
    const source = `开头结论：药物 X 可长期使用。${"普通正文".repeat(15_000)}\n\n关键更正：前述结论作废，药物 X 不得长期使用。`;
    const sampled = selectImportOutlineSourceText(source, 12_000);
    expect(sampled).toContain("开头结论");
    expect(sampled).toContain("前述结论作废");
    expect(sampled.length).toBeLessThanOrEqual(12_000);
  });

  it("逐节召回把显式更正作为事实安全片段保留", () => {
    const source = `药物 X 安全，可长期使用。${"无关铺垫".repeat(9_000)}\n\n前述结论作废：药物 X 不得长期使用，可能造成严重肝损伤。`;
    const picked = selectRelevantSourceText(source, { query: "药物 X 是否安全", lessonIndex: 0, lessonCount: 1 }, 4_000);
    expect(picked).toContain("可长期使用");
    expect(picked).toContain("前述结论作废");
    expect(picked).toContain("严重肝损伤");
  });
});
