import { describe, it, expect } from "vitest";
import { validateBlocks, blocksToPlainText } from "@/lib/blocks";
import { diagramHtml } from "@/lib/ai/courseware-diagrams";

/**
 * v4.3 语义图示块——协议校验与渲染纪律(leohtml:节点必须有标签、方向显式、结果强调)。
 */

const flowRaw = {
  type: "diagram",
  kind: "flow",
  title: "四段式",
  items: [
    { label: "背景", detail: "你是谁" },
    { label: "目标" },
    { label: "可用初稿" },
  ],
  note: "顺序不可换。",
};

describe("diagram 块协议校验", () => {
  it("合法 flow 块通过并保留字段", () => {
    const [b] = validateBlocks([flowRaw]);
    expect(b.type).toBe("diagram");
    if (b.type !== "diagram") return;
    expect(b.kind).toBe("flow");
    expect(b.items).toHaveLength(3);
    expect(b.title).toBe("四段式");
    expect(b.note).toBe("顺序不可换。");
  });

  it("kind 白名单外整块丢弃", () => {
    expect(validateBlocks([{ ...flowRaw, kind: "mindmap" }])).toHaveLength(0);
  });

  it("cycle/hub 少于 3 项不成形,丢弃;flow 2 项可成形", () => {
    const two = [{ label: "甲" }, { label: "乙" }];
    expect(validateBlocks([{ type: "diagram", kind: "cycle", items: two }])).toHaveLength(0);
    expect(validateBlocks([{ type: "diagram", kind: "hub", items: two }])).toHaveLength(0);
    expect(validateBlocks([{ type: "diagram", kind: "flow", items: two }])).toHaveLength(1);
  });

  it("无标签节点被剔除,全无标签则整块丢弃(拒绝空盒子)", () => {
    const dirty = { type: "diagram", kind: "flow", items: [{ label: "" }, { detail: "只有注" }, { label: "有效" }] };
    expect(validateBlocks([dirty])).toHaveLength(0); // 只剩 1 个有效项,低于 flow 最小 2 项
  });

  it("超长字段被截断、超量节点被裁剪到 6", () => {
    const many = { type: "diagram", kind: "flow", items: Array.from({ length: 9 }, (_, i) => ({ label: `节点${i}` })) };
    const [b] = validateBlocks([many]);
    if (b.type !== "diagram") throw new Error("type");
    expect(b.items).toHaveLength(6);
  });

  it("blocksToPlainText 输出图示文字(供安全扫描/检索)", () => {
    const text = blocksToPlainText(validateBlocks([flowRaw]));
    expect(text).toContain("背景");
    expect(text).toContain("顺序不可换");
  });
});

describe("diagram 渲染纪律", () => {
  it("每个节点标签都渲染在 HTML 里(无无标签图形)", () => {
    const [b] = validateBlocks([flowRaw]);
    if (b.type !== "diagram") throw new Error("type");
    const html = diagramHtml(b);
    for (const it of b.items) expect(html).toContain(it.label);
    expect(html).toContain("dg-note");
  });

  it("flow 末项强调为结果,箭头给出方向", () => {
    const [b] = validateBlocks([flowRaw]);
    if (b.type !== "diagram") throw new Error("type");
    const html = diagramHtml(b);
    expect(html).toContain("dg-node--result");
    expect(html).toContain("dg-arrow");
  });

  it("cycle 画环上箭头,hub 中心强调", () => {
    const [cy] = validateBlocks([{ type: "diagram", kind: "cycle", items: [{ label: "一" }, { label: "二" }, { label: "三" }] }]);
    const [hb] = validateBlocks([{ type: "diagram", kind: "hub", items: [{ label: "中心" }, { label: "甲" }, { label: "乙" }] }]);
    if (cy.type !== "diagram" || hb.type !== "diagram") throw new Error("type");
    expect(diagramHtml(cy)).toContain("dg-ring--head");
    const hubHtml = diagramHtml(hb);
    expect(hubHtml).toContain("dg-hub-center");
    expect(hubHtml).toContain("dg-node--result");
  });

  it("HTML 转义:标签中的注入字符被转义", () => {
    const [b] = validateBlocks([
      { type: "diagram", kind: "flow", items: [{ label: '<img src=x onerror=1>' }, { label: "乙" }] },
    ]);
    if (b.type !== "diagram") throw new Error("type");
    expect(diagramHtml(b)).not.toContain("<img");
  });
});
