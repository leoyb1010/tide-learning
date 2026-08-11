import { describe, it, expect } from "vitest";
import { showcaseIssues, type Block } from "@/lib/blocks";

/**
 * 块滥用自检 —— 锁死「高精度、不误杀」：
 * 它是咨询性反馈（进重写提示），不是发布门，所以宁可漏报也不能错杀一节正常课。
 */

const concept = (title = "概念"): Block => ({ type: "concept", title, markdown: "内容" });
const image = (): Block => ({ type: "image", src: "/illustration/auto.svg", caption: "图" });

describe("showcaseIssues —— 正常课不报警（防误杀）", () => {
  it("一节结构正常的课：零违例", () => {
    const blocks: Block[] = [
      { type: "scene", title: "为什么学", markdown: "场景" },
      { type: "objectives", items: ["会用 A", "会判断 B"] },
      concept("A 是什么"),
      { type: "example", markdown: "例子" },
      { type: "quiz", question: "题", options: ["甲", "乙"], answerIndex: 0, explain: "因为" },
      { type: "summary", markdown: "小结" },
    ];
    expect(showcaseIssues(blocks)).toEqual([]);
  });
  it("空课件不报警", () => {
    expect(showcaseIssues([])).toEqual([]);
  });
  it("四种特型块仍在容忍范围（阈值是 5 种）", () => {
    const blocks: Block[] = [
      { type: "diagram", kind: "flow", title: "流程", items: [{ label: "一" }, { label: "二" }, { label: "三" }] },
      { type: "code", lang: "python", code: "print(1)" },
      { type: "compare", left: { heading: "误区", items: ["a", "b"] }, right: { heading: "正确", items: ["c", "d"] } },
      image(),
      concept(),
    ];
    expect(showcaseIssues(blocks)).toEqual([]);
  });
});

describe("showcaseIssues —— 抓现行", () => {
  it("氛围图堆砌：image 超过一个", () => {
    const issues = showcaseIssues([concept(), image(), image(), image()]);
    expect(issues.some((i) => i.includes("氛围图") && i.includes("3 次"))).toBe(true);
  });
  it("套路化开场：多个 scene", () => {
    const issues = showcaseIssues([
      { type: "scene", title: "一", markdown: "x" },
      { type: "scene", title: "二", markdown: "y" },
    ]);
    expect(issues.some((i) => i.includes("场景开场"))).toBe(true);
  });
  it("展示协议而非讲课：5 种以上特型块", () => {
    const blocks: Block[] = [
      { type: "diagram", kind: "flow", title: "流程", items: [{ label: "一" }, { label: "二" }, { label: "三" }] },
      { type: "code", lang: "python", code: "print(1)" },
      { type: "formula", latex: "E=mc^2" },
      { type: "dialog", turns: [{ speaker: "A", text: "喂" }] },
      { type: "compare", left: { heading: "L", items: ["a", "b"] }, right: { heading: "R", items: ["c", "d"] } },
    ];
    expect(showcaseIssues(blocks).some((i) => i.includes("5 种特型块"))).toBe(true);
  });
  it("二元关系画流程图：diagram 节点不足 3 个", () => {
    const issues = showcaseIssues([
      { type: "diagram", kind: "flow", title: "输入输出", items: [{ label: "输入" }, { label: "输出" }] },
    ]);
    expect(issues.some((i) => i.includes("输入输出") && i.includes("2 个节点"))).toBe(true);
  });
  it("稻草人对比：一边 3 条一边 1 条", () => {
    const issues = showcaseIssues([
      { type: "compare", title: "新旧", left: { heading: "旧", items: ["就一条"] }, right: { heading: "新", items: ["a", "b", "c"] } },
    ]);
    expect(issues.some((i) => i.includes("稻草人"))).toBe(true);
  });
  it("两边都少但相当 → 不算稻草人", () => {
    const issues = showcaseIssues([
      { type: "compare", left: { heading: "旧", items: ["a"] }, right: { heading: "新", items: ["b"] } },
    ]);
    expect(issues).toEqual([]);
  });
  it("违例条数封顶 6，不淹没重写反馈", () => {
    const many: Block[] = [
      ...Array.from({ length: 4 }, image),
      { type: "scene", title: "一", markdown: "x" },
      { type: "scene", title: "二", markdown: "y" },
      { type: "objectives", items: ["a"] },
      { type: "objectives", items: ["b"] },
      { type: "summary", markdown: "一" },
      { type: "summary", markdown: "二" },
      { type: "diagram", kind: "flow", title: "甲", items: [{ label: "x" }] },
      { type: "diagram", kind: "hub", title: "乙", items: [{ label: "y" }] },
      { type: "code", lang: "py", code: "1" },
      { type: "formula", latex: "x" },
      { type: "dialog", turns: [{ speaker: "A", text: "喂" }] },
    ];
    expect(showcaseIssues(many).length).toBeLessThanOrEqual(6);
  });
});
