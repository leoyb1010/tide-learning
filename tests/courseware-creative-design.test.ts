import { describe, expect, it } from "vitest";
import {
  parseCreativeDesign,
  serializeCreativeDesign,
  validateCreativeDesign,
  verifyCreativeDesignUsage,
} from "@/lib/ai/courseware-creative-design";

const raw = {
  direction: "冷静的实验日志，以证据推进而非卡片罗列",
  palette: {
    background: { l: 0.97, c: 0.01, h: 80 },
    surface: { l: 0.93, c: 0.012, h: 80 },
    ink: { l: 0.18, c: 0.02, h: 250 },
    muted: { l: 0.36, c: 0.02, h: 250 },
    accent: { l: 0.42, c: 0.14, h: 25 },
    accentInk: { l: 0.98, c: 0.005, h: 80 },
  },
  font: "humanist-sans",
  radiusPx: 9,
  gridColumns: 7,
  spacingUnit: 10,
  motif: "逐层显影的实验记录纸",
  layoutStrategy: "主论证沿左侧纵轴推进，练习穿插在证据节点之间",
  motion: { durationMs: 460, easing: [0.16, 1, 0.3, 1], signature: "结论随证据由下向上显影" },
};

describe("单节原创设计 token 闸门", () => {
  it("接受合法、对比度达标的模型设计并可稳定落库", () => {
    const checked = validateCreativeDesign(raw);
    expect(checked.ok).toBe(true);
    expect(checked.design?.palette.background.hex).toMatch(/^#[0-9a-f]{6}$/);
    const restored = parseCreativeDesign(serializeCreativeDesign(checked.design!));
    expect(restored).toEqual(checked.design);
  });

  it("拒绝不可读色板，不替模型自动修色", () => {
    const checked = validateCreativeDesign({
      ...raw,
      palette: { ...raw.palette, ink: { l: 0.9, c: 0.01, h: 80 } },
    });
    expect(checked.ok).toBe(false);
    expect(checked.issues.some((issue) => issue.includes("对比度"))).toBe(true);
  });

  it("确认 bespoke HTML 原样声明并实际使用本节 token", () => {
    const design = validateCreativeDesign(raw).design!;
    const p = design.palette;
    const html = `<style>:root{--cw-bg:${p.background.hex};--cw-surface:${p.surface.hex};--cw-ink:${p.ink.hex};--cw-muted:${p.muted.hex};--cw-accent:${p.accent.hex};--cw-accent-ink:${p.accentInk.hex}}body{background:var(--cw-bg);color:var(--cw-ink)}section{background:var(--cw-surface);color:var(--cw-muted)}button{background:var(--cw-accent);color:var(--cw-accent-ink)}</style>`;
    expect(verifyCreativeDesignUsage(html, design)).toEqual([]);
    expect(verifyCreativeDesignUsage("<style>body{color:red}</style>", design).length).toBeGreaterThan(0);
  });
});
