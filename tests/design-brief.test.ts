import { describe, it, expect } from "vitest";
import {
  sanitizeBrief,
  synthesizeArtDirection,
  briefContrastReport,
  type DesignBrief,
  CHROMA,
  SUBSTRATE,
  PAPER_TINT,
} from "../src/lib/ai/design-brief";
import { hexToRgb, contrastHex, oklchToHex } from "../src/lib/ai/color-oklch";

const HEX = /^#[0-9a-f]{6}$/;

describe("color-oklch 基础", () => {
  it("oklchToHex 任意输入都产合法 #rrggbb（含越界 chroma 收敛进色域）", () => {
    for (const [L, C, H] of [
      [0.5, 0.4, 30], // 超高 chroma，必越界→收敛
      [0.98, 0.2, 200],
      [0.02, 0.3, 120],
      [0.6, 0, 0],
    ] as const) {
      expect(oklchToHex(L, C, H)).toMatch(HEX);
    }
  });

  it("contrastHex 非法输入返回 0（防注入：脏 hex→最差对比度→上层回退）", () => {
    expect(contrastHex("javascript:alert(1)", "#ffffff")).toBe(0);
    expect(contrastHex("#fff", "not-a-color")).toBe(0);
    expect(contrastHex("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

describe("sanitizeBrief 钳制", () => {
  it("越界/脏字段全部回落合法词表", () => {
    const b = sanitizeBrief({
      accentHue: 725, // →725%360=5
      chroma: "neon", // 非法→balanced
      substrate: "glass", // 非法→light
      font: "comic-sans", // 非法→sans-clean
      layout: "<script>", // 非法→soft
      motionSig: "explode",
      radius: 999,
      texture: "url(evil)",
      paperTint: "spicy",
    });
    expect(b.accentHue).toBe(5);
    expect(CHROMA).toContain(b.chroma);
    expect(SUBSTRATE).toContain(b.substrate);
    expect(PAPER_TINT).toContain(b.paperTint);
    expect(b.layout).toBe("soft");
    expect(b.font).toBe("sans-clean");
  });

  it("空/undefined 输入产完整默认 brief", () => {
    const b = sanitizeBrief(undefined);
    expect(b.accentHue).toBeGreaterThanOrEqual(0);
    expect(b.accentHue).toBeLessThan(360);
    expect(HEX.test(synthesizeArtDirection(b).accent)).toBe(true);
  });
});

describe("synthesizeArtDirection：配色永不产脏值 + 对比度构造达标", () => {
  // 全色相 × 明暗 × 浓度 扫一遍：这是「生成配色永远可读」的护栏。
  const hues = Array.from({ length: 24 }, (_, i) => i * 15); // 0,15,...,345
  it("所有组合的关键文字对比度达标（正文≥7 / 次要≥4.5 / 强调≥4.5）", () => {
    let checked = 0;
    for (const accentHue of hues) {
      for (const substrate of SUBSTRATE) {
        for (const chroma of CHROMA) {
          const brief: DesignBrief = {
            accentHue,
            chroma,
            substrate,
            paperTint: "neutral",
            font: "sans-clean",
            layout: "soft",
            motionSig: "rise",
            radius: "soft",
            texture: "none",
          };
          const r = briefContrastReport(brief);
          expect(r.inkOnSurface, `ink hue${accentHue} ${substrate} ${chroma}`).toBeGreaterThanOrEqual(7);
          expect(r.ink2OnSurface, `ink2 hue${accentHue} ${substrate} ${chroma}`).toBeGreaterThanOrEqual(4.5);
          expect(r.accentOnBg, `accent hue${accentHue} ${substrate} ${chroma}`).toBeGreaterThanOrEqual(4.5);
          checked++;
        }
      }
    }
    expect(checked).toBe(hues.length * 2 * 3);
  });

  it("所有 12 个颜色字段都是合法 #rrggbb（无自由字符串进 CSS）", () => {
    const art = synthesizeArtDirection(
      sanitizeBrief({ accentHue: 175, chroma: "vivid", substrate: "light" }),
    );
    for (const k of ["bg", "surface", "surfaceAlt", "ink", "ink2", "ink3", "border", "accent", "accentInk", "accentSoft"] as const) {
      expect(hexToRgb(art[k]), `${k}=${art[k]}`).not.toBeNull();
    }
    expect(typeof art.radius).toBe("number");
    expect(art.ease).toMatch(/^cubic-bezier\([\d.,\s]+\)$/);
    // 字体/纹理来自白名单表，不含 <>、url(、分号注入
    expect(art.fontDisplay + art.texture).not.toMatch(/[<>;]|url\(/);
  });

  it("同 brief 确定性：两次合成完全一致", () => {
    const b = sanitizeBrief({ accentHue: 42, chroma: "muted", substrate: "dark", font: "mono-technical" });
    expect(JSON.stringify(synthesizeArtDirection(b))).toBe(JSON.stringify(synthesizeArtDirection(b)));
  });

  it("dark 底与 light 底产出不同的 bg 明度方向", () => {
    const light = synthesizeArtDirection(sanitizeBrief({ accentHue: 210, substrate: "light" }));
    const dark = synthesizeArtDirection(sanitizeBrief({ accentHue: 210, substrate: "dark" }));
    const lum = (hex: string) => {
      const c = hexToRgb(hex)!;
      return (c.r + c.g + c.b) / 3;
    };
    expect(lum(light.bg)).toBeGreaterThan(lum(dark.bg));
  });
});
