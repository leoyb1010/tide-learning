import { describe, expect, it } from "vitest";
import { blocksToAssessmentManifest, validateBlocks } from "@/lib/blocks";

describe("assessment manifest", () => {
  it("把真实答案键、答案文本和解析同时交给教学评审", () => {
    const blocks = validateBlocks([
      { type: "quiz", question: "2+2 等于？", options: ["3", "4"], answerIndex: 0, explain: "正确答案是 4。" },
    ]);
    const manifest = blocksToAssessmentManifest(blocks);
    expect(manifest).toContain('"answerIndex":0');
    expect(manifest).toContain('"correctAnswer":"3"');
    expect(manifest).toContain("正确答案是 4");
  });

  it("缺失或越界答案键的 quiz 被丢弃，不静默把第一项判正确", () => {
    expect(validateBlocks([{ type: "quiz", question: "题", options: ["甲", "乙"] }])).toHaveLength(0);
    expect(validateBlocks([{ type: "quiz", question: "题", options: ["甲", "乙"], answerIndex: 9 }])).toHaveLength(0);
  });
});
