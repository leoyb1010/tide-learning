import { describe, it, expect } from "vitest";
import { validateBlocks, blocksToPlainText } from "@/lib/blocks";
import { renderFormula } from "@/lib/ai/courseware-math";
import { interactiveHtml, INTERACTIVE_RUNTIME } from "@/lib/ai/courseware-interactive";

/**
 * v4.3 新块协议校验 + 渲染纪律：formula(KaTeX) / fillblank / dragwords(H5P 式交互)。
 */

describe("formula 块协议", () => {
  it("合法 latex 通过，display 缺省 true", () => {
    const [b] = validateBlocks([{ type: "formula", latex: "E=mc^2", caption: "质能" }]);
    expect(b.type).toBe("formula");
    if (b.type !== "formula") return;
    expect(b.latex).toBe("E=mc^2");
    expect(b.display).toBe(true);
    expect(b.caption).toBe("质能");
  });
  it("空 latex 整块丢弃", () => {
    expect(validateBlocks([{ type: "formula", latex: "" }])).toHaveLength(0);
    expect(validateBlocks([{ type: "formula" }])).toHaveLength(0);
  });
  it("display:false 保留（行内）", () => {
    const [b] = validateBlocks([{ type: "formula", latex: "x^2", display: false }]);
    if (b.type !== "formula") throw new Error("type");
    expect(b.display).toBe(false);
  });
});

describe("renderFormula(KaTeX)", () => {
  it("正常 latex → 自包含 katex HTML（无外链、无脚本）", () => {
    const html = renderFormula("\\frac{a}{b}", true);
    expect(html).toContain("katex");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
  });
  it("非法 latex → 回落纯文本，不抛", () => {
    const html = renderFormula("\\frac{", true);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("fillblank 块协议", () => {
  const raw = { type: "fillblank", prompt: "补全", segments: ["I ", " home."], blanks: [["go", "walk"]] };
  it("段数=空数+1 时通过，多写法保留", () => {
    const [b] = validateBlocks([raw]);
    expect(b.type).toBe("fillblank");
    if (b.type !== "fillblank") return;
    expect(b.segments).toHaveLength(2);
    expect(b.blanks).toEqual([["go", "walk"]]);
  });
  it("段数与空数不匹配 → 丢弃", () => {
    expect(validateBlocks([{ type: "fillblank", segments: ["a", "b", "c"], blanks: [["x"]] }])).toHaveLength(0);
  });
  it("无空 → 丢弃", () => {
    expect(validateBlocks([{ type: "fillblank", segments: ["a"], blanks: [] }])).toHaveLength(0);
  });
  it("plaintext 还原完整句（取第一个正解）", () => {
    const text = blocksToPlainText(validateBlocks([raw]));
    expect(text).toContain("I go home.");
  });
});

describe("dragwords 块协议", () => {
  const raw = { type: "dragwords", segments: ["虚拟语气用于", "的情况。"], blanks: ["假设"], distractors: ["陈述", "命令"] };
  it("通过并保留 blanks/distractors", () => {
    const [b] = validateBlocks([raw]);
    expect(b.type).toBe("dragwords");
    if (b.type !== "dragwords") return;
    expect(b.blanks).toEqual(["假设"]);
    expect(b.distractors).toEqual(["陈述", "命令"]);
  });
  it("段数与空数不匹配 → 丢弃", () => {
    expect(validateBlocks([{ type: "dragwords", segments: ["a"], blanks: ["x"] }])).toHaveLength(0);
  });
});

describe("交互块渲染纪律", () => {
  it("fillblank：每空一个 input 带 data-ans；判分答案不明文暴露为可见文字", () => {
    const [b] = validateBlocks([{ type: "fillblank", segments: ["A ", " B"], blanks: [["ans1", "alt1"]] }]);
    if (b.type !== "fillblank") throw new Error("type");
    const html = interactiveHtml(b);
    expect((html.match(/class="fb-in"/g) || []).length).toBe(1);
    expect(html).toContain("data-ans");
    expect(html).toContain('data-ia="fill"');
  });
  it("dragwords：词库含正解+干扰词，答案顺序在容器 data-ans", () => {
    const [b] = validateBlocks([
      { type: "dragwords", segments: ["", "", ""], blanks: ["甲", "乙"], distractors: ["丙"] },
    ]);
    if (b.type !== "dragwords") throw new Error("type");
    const html = interactiveHtml(b);
    expect((html.match(/class="dw-word"/g) || []).length).toBe(3); // 2 正解 + 1 干扰
    expect((html.match(/class="dw-slot"/g) || []).length).toBe(2);
    expect(html).toContain('data-ia="drag"');
  });
  it("确定性：同块 id 两次渲染完全一致（词库洗牌可复现）", () => {
    const [b] = validateBlocks([
      { type: "dragwords", segments: ["", "", ""], blanks: ["甲", "乙"], distractors: ["丙", "丁"] },
    ]);
    if (b.type !== "dragwords") throw new Error("type");
    expect(interactiveHtml(b)).toBe(interactiveHtml(b));
  });
  it("HTML 转义：注入字符被转义", () => {
    const [b] = validateBlocks([
      { type: "fillblank", segments: ['<img onerror=1> ', " x"], blanks: [["a"]] },
    ]);
    if (b.type !== "fillblank") throw new Error("type");
    expect(interactiveHtml(b)).not.toContain("<img");
  });
  it("runtime 判分脚本回传 ct-quiz（进错题闭环）", () => {
    expect(INTERACTIVE_RUNTIME).toContain("ct-quiz");
  });
});
