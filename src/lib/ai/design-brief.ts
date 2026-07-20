/**
 * 设计 brief（v5）——LLM 为每门课产出的「语义化视觉方向」，平台据此确定性合成完整 ArtDirection。
 *
 * 关键架构：LLM 不产原始 CSS/hex（那样既伤可读、又是沙箱注入面），只产**闭合词表里的选择 + 一个色相整数**。
 * 平台的 synthesizeArtDirection 用 OKLCH 色彩科学把它编译成对比度达标的整套 token。
 * 这样：色相连续 → 每门课独一无二；对比度构造即达标 → 永不出脏配色；无自由字符串进 <style> → 零注入面。
 * LLM 干它擅长的「创意方向」（海洋生物学→深青、沉静、编辑风、幕帘动效、波纹母题），
 * 平台干它擅长的「色彩数学」（LLM 直接产 hex 往往发脏、过不了对比度）。
 */

import type { ArtDirection } from "./courseware-design";
import { oklchToHex, oklchToRgb, rgbToHex, textColorFor, hexToRgb, contrastRatio } from "./color-oklch";

// —— 闭合词表（LLM 只能从这些里选；越界值在 sanitize 时回落默认）——
export const CHROMA = ["muted", "balanced", "vivid"] as const;
export const SUBSTRATE = ["light", "dark"] as const;
export const PAPER_TINT = ["neutral", "warm", "cool"] as const;
export const FONT_PERSONALITY = [
  "serif-editorial", // 衬线编辑感
  "sans-clean", // 无衬线克制
  "mono-technical", // 等宽工程感
  "rounded-friendly", // 圆润亲和
  "grotesk-bold", // 粗黑杂志感
] as const;
export const LAYOUT = ["editorial", "terminal", "magazine", "zen", "soft"] as const;
export const MOTION_SIG = ["rise", "draw", "type", "curtain", "slide"] as const;
export const RADIUS_STEP = ["sharp", "soft", "round"] as const;
export const TEXTURE = ["none", "grid", "dots", "topo", "grain"] as const;

export interface DesignBrief {
  accentHue: number; // 0-359 本课品牌色相
  chroma: (typeof CHROMA)[number];
  substrate: (typeof SUBSTRATE)[number];
  paperTint: (typeof PAPER_TINT)[number];
  font: (typeof FONT_PERSONALITY)[number];
  layout: (typeof LAYOUT)[number];
  motionSig: (typeof MOTION_SIG)[number];
  radius: (typeof RADIUS_STEP)[number];
  texture: (typeof TEXTURE)[number];
}

const DEFAULT_BRIEF: DesignBrief = {
  accentHue: 220,
  chroma: "balanced",
  substrate: "light",
  paperTint: "neutral",
  font: "sans-clean",
  layout: "soft",
  motionSig: "rise",
  radius: "soft",
  texture: "none",
};

function pick<T extends readonly string[]>(vocab: T, v: unknown, fallback: T[number]): T[number] {
  return typeof v === "string" && (vocab as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

/**
 * 把 LLM 原始输出钳成合法 DesignBrief：每个枚举字段越界即回落默认，色相取模到 0-359。
 * 任何脏输入（含注入尝试）都收敛为安全值——这是 LLM 产物到渲染层之间的唯一闸门。
 */
export function sanitizeBrief(raw: unknown): DesignBrief {
  const r = (raw ?? {}) as Record<string, unknown>;
  let hue = Number(r.accentHue);
  if (!Number.isFinite(hue)) hue = DEFAULT_BRIEF.accentHue;
  hue = ((Math.round(hue) % 360) + 360) % 360;
  return {
    accentHue: hue,
    chroma: pick(CHROMA, r.chroma, DEFAULT_BRIEF.chroma),
    substrate: pick(SUBSTRATE, r.substrate, DEFAULT_BRIEF.substrate),
    paperTint: pick(PAPER_TINT, r.paperTint, DEFAULT_BRIEF.paperTint),
    font: pick(FONT_PERSONALITY, r.font, DEFAULT_BRIEF.font),
    layout: pick(LAYOUT, r.layout, DEFAULT_BRIEF.layout),
    motionSig: pick(MOTION_SIG, r.motionSig, DEFAULT_BRIEF.motionSig),
    radius: pick(RADIUS_STEP, r.radius, DEFAULT_BRIEF.radius),
    texture: pick(TEXTURE, r.texture, DEFAULT_BRIEF.texture),
  };
}

// —— 字体：白名单字族栈（复用 BASE_ARTS 里久经验证的跨端系统栈，CSP 安全、零外链）——
const FONT_TABLE: Record<
  DesignBrief["font"],
  { display: string; body: string; mono: string; weight: number; tracking: string }
> = {
  "serif-editorial": {
    display: "Georgia, 'Songti SC', 'Noto Serif SC', 'Times New Roman', serif",
    body: "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
    weight: 700,
    tracking: "-0.02em",
  },
  "sans-clean": {
    display: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    body: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
    weight: 800,
    tracking: "-0.035em",
  },
  "mono-technical": {
    display: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    body: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
    weight: 700,
    tracking: "-0.01em",
  },
  "rounded-friendly": {
    display: "'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif",
    body: "'PingFang SC', system-ui, -apple-system, sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
    weight: 700,
    tracking: "-0.01em",
  },
  "grotesk-bold": {
    display: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    body: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    weight: 900,
    tracking: "-0.04em",
  },
};

const RADIUS_PX: Record<DesignBrief["radius"], number> = { sharp: 5, soft: 14, round: 22 };

// —— 母题纹理：受控枚举 → 安全 CSS background-image（用强调色注入，避免自由 CSS 值/注入）——
function textureCss(t: DesignBrief["texture"], accent: string, dark: boolean): string {
  const rgb = hexToRgb(accent) ?? { r: 128, g: 128, b: 128 };
  const rgba = (op: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${op})`;
  const lineOp = dark ? 0.05 : 0.06;
  switch (t) {
    case "grid":
      return `linear-gradient(${rgba(lineOp)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(lineOp)} 1px, transparent 1px)`;
    case "dots":
      return `radial-gradient(circle at 1px 1px, ${rgba(dark ? 0.07 : 0.08)} 1px, transparent 0)`;
    case "topo":
      // 极淡等高线感：两层错位斜纹
      return `repeating-linear-gradient(38deg, ${rgba(lineOp)} 0 1px, transparent 1px 22px)`;
    case "grain":
      return `radial-gradient(circle at 40% 30%, ${rgba(0.05)} 0.5px, transparent 1px), radial-gradient(circle at 75% 65%, ${rgba(0.04)} 0.5px, transparent 1px)`;
    case "none":
    default:
      return "none";
  }
}

// motionSig → cubic-bezier 基调（平台派定，不交给 LLM，保证动效手感统一到位）。
const EASE_FOR: Record<DesignBrief["motionSig"], string> = {
  rise: "cubic-bezier(0.16, 1, 0.3, 1)",
  draw: "cubic-bezier(0.16, 1, 0.3, 1)",
  type: "cubic-bezier(0.32, 0.72, 0, 1)",
  curtain: "cubic-bezier(0.22, 1, 0.36, 1)",
  slide: "cubic-bezier(0.32, 0.72, 0, 1)",
};

const CHROMA_C: Record<DesignBrief["chroma"], number> = { muted: 0.05, balanced: 0.1, vivid: 0.16 };
// paperTint → 底色微色相（暖=偏橙、冷=偏蓝、中性=跟随品牌色相）。
const TINT_HUE: Record<DesignBrief["paperTint"], number | null> = { neutral: null, warm: 70, cool: 250 };

/**
 * 把 DesignBrief 确定性编译为完整 ArtDirection：
 * - 配色用 OKLCH 造感知均匀色阶，文字色实测 WCAG 步进保证 正文≥7:1 / 次要≥4.5:1 / 强调≥4.5:1；
 * - 字体/圆角/纹理/ease 全走白名单表，无自由字符串；
 * - layout/motionSig 透传为 v4.5 的版式/动效基因。
 * 纯函数、无随机、无 IO：同 brief 必得同 art（可复现，改算法后重渲即升级所有旧课）。
 */
export function synthesizeArtDirection(brief: DesignBrief): ArtDirection {
  const H = brief.accentHue;
  const dark = brief.substrate === "dark";
  const accentC = CHROMA_C[brief.chroma];
  const tintH = TINT_HUE[brief.paperTint] ?? H;
  const neutralC = brief.paperTint === "neutral" ? 0.008 : 0.014; // 底色微染

  // 底色/面/边框：低 chroma 中性阶，带一点点色温。
  // 单一真源：surface/bg 的 rgb 与写进 CSS 的 hex 用同一 (L,C,H) 求得——文字对比度对着「真正渲染出的
  // surface/bg」优化，避免参考色与渲染色不一致（修 review #1）。
  const surfaceL = dark ? 0.205 : 0.995;
  const surfaceC = dark ? neutralC : neutralC * 0.6;
  const surfaceRgb = oklchToRgb(surfaceL, surfaceC, tintH);
  const surface = rgbToHex(surfaceRgb);
  const bgL = dark ? 0.16 : 0.975;
  const bgRgb = oklchToRgb(bgL, neutralC, tintH);
  const bg = rgbToHex(bgRgb);
  const surfaceAlt = dark ? oklchToHex(0.25, neutralC, tintH) : oklchToHex(0.935, neutralC * 1.4, tintH);
  const border = dark ? oklchToHex(0.32, neutralC * 1.4, tintH) : oklchToHex(0.88, neutralC * 1.6, tintH);

  // 文字阶：对 surface 达标（正文对 surface 是最常见组合）。dark 底文字变亮(dir+1)，light 底变暗(dir-1)。
  const dir: -1 | 1 = dark ? 1 : -1;
  const ink = textColorFor(surfaceRgb, H, 0.02, dark ? 0.94 : 0.24, 7.5, dir);
  const ink2 = textColorFor(surfaceRgb, H, 0.02, dark ? 0.72 : 0.44, 4.6, dir);
  const ink3 = textColorFor(surfaceRgb, H, 0.018, dark ? 0.58 : 0.6, 3.1, dir);

  // 强调色：对 bg 达标（强调常在 bg 上做胶囊/链接/标注）。
  const accent = textColorFor(bgRgb, H, accentC, dark ? 0.7 : 0.55, 4.5, dir);
  const accentInk = textColorFor(bgRgb, H, accentC * 0.9, dark ? 0.78 : 0.46, 5.2, dir);
  const accentSoft = dark ? oklchToHex(0.26, accentC * 0.5, H) : oklchToHex(0.94, accentC * 0.45, H);

  const font = FONT_TABLE[brief.font];

  return {
    key: "generated",
    label: "本课专属",
    mood: `hue ${H} · ${brief.chroma} · ${brief.substrate}`,
    substrate: brief.substrate,
    bg,
    surface,
    surfaceAlt,
    ink,
    ink2,
    ink3,
    border,
    accent,
    accentInk,
    accentSoft,
    fontDisplay: font.display,
    fontBody: font.body,
    fontMono: font.mono,
    displayWeight: font.weight,
    displayTracking: font.tracking,
    radius: RADIUS_PX[brief.radius],
    texture: textureCss(brief.texture, accent, dark),
    ease: EASE_FOR[brief.motionSig],
    layout: brief.layout,
    motion: brief.motionSig,
  };
}

/** 自检：合成后的关键文字对比度是否达标（供单测复用；对比度保证由 tests/design-brief.test.ts 全色相扫描锁死）。 */
export function briefContrastReport(brief: DesignBrief) {
  const art = synthesizeArtDirection(brief);
  const s = hexToRgb(art.surface)!;
  const b = hexToRgb(art.bg)!;
  return {
    inkOnSurface: contrastRatio(hexToRgb(art.ink)!, s),
    ink2OnSurface: contrastRatio(hexToRgb(art.ink2)!, s),
    accentOnBg: contrastRatio(hexToRgb(art.accent)!, b),
  };
}
