import { describe, expect, it } from "vitest";
import { blocksToAssessmentManifest, blocksToAssessmentManifestBatches, validateBlocks } from "@/lib/blocks";

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

  it("拒绝空白或重复选项，保证答案文本唯一", () => {
    expect(validateBlocks([
      { type: "quiz", question: "2+2？", options: ["4", " 4 "], answerIndex: 0, explain: "答案是 4" },
    ])).toHaveLength(0);
    expect(validateBlocks([
      { type: "quiz", question: "2+2？", options: ["", "4"], answerIndex: 1, explain: "答案是 4" },
    ])).toHaveLength(0);
  });

  it("长判分清单按完整 assessment 分批，每批都是合法 JSON 且尾题不丢", () => {
    const blocks = validateBlocks(Array.from({ length: 60 }, (_, index) => ({
      id: `quiz_${index}`,
      type: "quiz",
      question: `第 ${index + 1} 题`,
      options: [`错误 ${index}`, `正确 ${index}`],
      answerIndex: 1,
      explain: `解析 ${index}：${"完整证据".repeat(180)}`,
    })));
    const batches = blocksToAssessmentManifestBatches(blocks, 12_000);
    const parsed = batches.flatMap((batch) => JSON.parse(batch) as { id: string }[]);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.length <= 12_000)).toBe(true);
    expect(parsed).toHaveLength(60);
    expect(parsed.at(-1)?.id).toBe("quiz_59");
  });
});
