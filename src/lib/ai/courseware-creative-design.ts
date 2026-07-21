/**
 * 单节原创设计系统（v6）。
 *
 * 模型负责原创方向与 OKLCH token；平台只做安全、合法值域、字体白名单与 WCAG 对比度校验。
 * 这里没有预置皮肤、版式枚举或自动调色修正：不合格就让设计 Agent 重做，而不是把结果收敛回平台模板。
 */

import { blocksToPlainText, type Block } from "../blocks";
import { creditingOnUsage } from "../credits";
import { chatJson } from "../llm";
import { contrastRatio, oklchToRgb, rgbToHex } from "./color-oklch";
import { bespokeTimeoutMs, type LlmModelEntry } from "./models";

export const CREATIVE_FONT_KEYS = [
  "system-sans",
  "editorial-serif",
  "technical-mono",
  "humanist-sans",
  "rounded-sans",
] as const;

export type CreativeFontKey = (typeof CREATIVE_FONT_KEYS)[number];

interface RawOklch {
  l?: unknown;
  c?: unknown;
  h?: unknown;
}

interface RawCreativeDesign {
  direction?: unknown;
  palette?: {
    background?: RawOklch;
    surface?: RawOklch;
    ink?: RawOklch;
    muted?: RawOklch;
    accent?: RawOklch;
    accentInk?: RawOklch;
  };
  font?: unknown;
  radiusPx?: unknown;
  gridColumns?: unknown;
  spacingUnit?: unknown;
  motif?: unknown;
  layoutStrategy?: unknown;
  motion?: {
    durationMs?: unknown;
    easing?: unknown;
    signature?: unknown;
  };
}

export interface CreativeColorToken {
  l: number;
  c: number;
  h: number;
  hex: string;
}

export interface LessonCreativeDesign {
  v: 1;
  direction: string;
  palette: {
    background: CreativeColorToken;
    surface: CreativeColorToken;
    ink: CreativeColorToken;
    muted: CreativeColorToken;
    accent: CreativeColorToken;
    accentInk: CreativeColorToken;
  };
  font: CreativeFontKey;
  fontStack: string;
  radiusPx: number;
  gridColumns: number;
  spacingUnit: number;
  motif: string;
  layoutStrategy: string;
  motion: {
    durationMs: number;
    easing: [number, number, number, number];
    signature: string;
  };
}

export interface CreativeDesignValidation {
  ok: boolean;
  design: LessonCreativeDesign | null;
  issues: string[];
}

const FONT_STACKS: Record<CreativeFontKey, string> = {
  "system-sans": "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
  "editorial-serif": "Georgia, 'Songti SC', 'Noto Serif SC', 'Times New Roman', serif",
  "technical-mono": "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace",
  "humanist-sans": "Optima, Candara, 'PingFang SC', system-ui, sans-serif",
  "rounded-sans": "'Arial Rounded MT Bold', 'PingFang SC', system-ui, sans-serif",
};

const COLOR_KEYS = ["background", "surface", "ink", "muted", "accent", "accentInk"] as const;

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanCreativeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text.length >= 2 ? text : null;
}

function parseColor(value: RawOklch | undefined, name: string, issues: string[]): CreativeColorToken | null {
  const l = finiteNumber(value?.l);
  const c = finiteNumber(value?.c);
  const h = finiteNumber(value?.h);
  if (l === null || c === null || h === null) {
    issues.push(`${name} 缺少合法 OKLCH 数值`);
    return null;
  }
  if (l < 0.04 || l > 0.98) issues.push(`${name}.l 必须在 0.04-0.98`);
  if (c < 0 || c > 0.32) issues.push(`${name}.c 必须在 0-0.32`);
  if (l < 0.04 || l > 0.98 || c < 0 || c > 0.32) return null;
  const hue = ((h % 360) + 360) % 360;
  return { l, c, h: hue, hex: rgbToHex(oklchToRgb(l, c, hue)) };
}

function ratio(a: CreativeColorToken, b: CreativeColorToken): number {
  return contrastRatio(oklchToRgb(a.l, a.c, a.h), oklchToRgb(b.l, b.c, b.h));
}

/**
 * 严格校验设计 Agent 的原始 token。平台不会替模型“调好看”，只会拒绝不安全或不可读的结果。
 */
export function validateCreativeDesign(raw: unknown): CreativeDesignValidation {
  const r = (raw ?? {}) as RawCreativeDesign;
  const issues: string[] = [];
  const colors = {} as Record<(typeof COLOR_KEYS)[number], CreativeColorToken>;
  for (const key of COLOR_KEYS) {
    const parsed = parseColor(r.palette?.[key], `palette.${key}`, issues);
    if (parsed) colors[key] = parsed;
  }

  const direction = cleanCreativeText(r.direction, 180);
  const motif = cleanCreativeText(r.motif, 140);
  const layoutStrategy = cleanCreativeText(r.layoutStrategy, 180);
  const signature = cleanCreativeText(r.motion?.signature, 140);
  if (!direction) issues.push("direction 不能为空");
  if (!motif) issues.push("motif 不能为空");
  if (!layoutStrategy) issues.push("layoutStrategy 不能为空");
  if (!signature) issues.push("motion.signature 不能为空");

  const font = typeof r.font === "string" && (CREATIVE_FONT_KEYS as readonly string[]).includes(r.font)
    ? (r.font as CreativeFontKey)
    : null;
  if (!font) issues.push("font 不在自包含字体白名单");

  const radiusPx = finiteNumber(r.radiusPx);
  const gridColumns = finiteNumber(r.gridColumns);
  const spacingUnit = finiteNumber(r.spacingUnit);
  const durationMs = finiteNumber(r.motion?.durationMs);
  const easingRaw = Array.isArray(r.motion?.easing) ? r.motion?.easing.map(finiteNumber) : [];
  const numericEasing = easingRaw.length === 4 && easingRaw.every((v): v is number => v !== null)
    ? (easingRaw as [number, number, number, number])
    : null;

  if (radiusPx === null || radiusPx < 0 || radiusPx > 40) issues.push("radiusPx 必须在 0-40");
  if (gridColumns === null || !Number.isInteger(gridColumns) || gridColumns < 1 || gridColumns > 12) issues.push("gridColumns 必须是 1-12 的整数");
  if (spacingUnit === null || spacingUnit < 4 || spacingUnit > 24) issues.push("spacingUnit 必须在 4-24");
  if (durationMs === null || durationMs < 120 || durationMs > 1400) issues.push("motion.durationMs 必须在 120-1400");
  if (!numericEasing || numericEasing[0] < 0 || numericEasing[0] > 1 || numericEasing[2] < 0 || numericEasing[2] > 1 || numericEasing[1] < -1 || numericEasing[1] > 2.5 || numericEasing[3] < -1 || numericEasing[3] > 2.5) {
    issues.push("motion.easing 必须是合法 cubic-bezier 四元组");
  }

  if (COLOR_KEYS.every((key) => Boolean(colors[key]))) {
    const checks: Array<[string, number, number]> = [
      ["正文/底色", ratio(colors.ink, colors.background), 4.5],
      ["正文/卡面", ratio(colors.ink, colors.surface), 4.5],
      ["次要文字/底色", ratio(colors.muted, colors.background), 4.5],
      ["次要文字/卡面", ratio(colors.muted, colors.surface), 4.5],
      ["强调色/底色", ratio(colors.accent, colors.background), 3],
      ["强调文字/强调色", ratio(colors.accentInk, colors.accent), 4.5],
    ];
    for (const [label, actual, minimum] of checks) {
      if (actual < minimum) issues.push(`${label}对比度 ${actual.toFixed(2)}，低于 ${minimum}:1`);
    }
  }

  if (issues.length > 0 || !direction || !motif || !layoutStrategy || !signature || !font || radiusPx === null || gridColumns === null || spacingUnit === null || durationMs === null || !numericEasing) {
    return { ok: false, design: null, issues };
  }

  return {
    ok: true,
    issues: [],
    design: {
      v: 1,
      direction,
      palette: colors,
      font,
      fontStack: FONT_STACKS[font],
      radiusPx: Math.round(radiusPx),
      gridColumns: Math.round(gridColumns),
      spacingUnit: Math.round(spacingUnit * 10) / 10,
      motif,
      layoutStrategy,
      motion: {
        durationMs: Math.round(durationMs),
        easing: numericEasing,
        signature,
      },
    },
  };
}

export function parseCreativeDesign(json: string | null | undefined): LessonCreativeDesign | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if ((parsed as { v?: unknown })?.v !== 1) return null;
    return validateCreativeDesign(parsed).design;
  } catch {
    return null;
  }
}

export function serializeCreativeDesign(design: LessonCreativeDesign): string {
  return JSON.stringify(design);
}

function priorSummary(design: LessonCreativeDesign): string {
  const p = design.palette;
  return `${design.direction}; bg ${p.background.hex}; accent ${p.accent.hex}; ${design.font}; ${design.layoutStrategy}; motif ${design.motif}`;
}

/** 每节单独调用设计 Agent；不怕 token，校验失败持续带具体问题重做，确定性只作最后安全网。 */
export async function generateLessonCreativeDesign(input: {
  courseTitle: string;
  category?: string | null;
  lessonTitle: string;
  objective?: string | null;
  blocks: (Block & { id: string })[];
  previousDesigns?: LessonCreativeDesign[];
  userId: string;
  model: LlmModelEntry;
}): Promise<{ design: LessonCreativeDesign | null; issues: string[] }> {
  const content = blocksToPlainText(input.blocks).slice(0, 7000);
  const previous = (input.previousDesigns ?? []).slice(0, 3).map(priorSummary);
  let feedback = "";
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const raw = await chatJson<RawCreativeDesign>({
        system:
          "你是课程视觉总监。针对这一节的内容原创一套设计系统，不准从固定皮肤或常见课件模板里选。" +
          "先理解主题、受众、情绪与教学动作，再决定色板、字体、栅格、母题和动效。" +
          "同一课程各节应像同一家族的不同章节，但轮廓、构图、母题和用色比例不能复制。" +
          "颜色必须直接输出 OKLCH 数值，由平台只做合法性和 WCAG 校验，不会替你修色。" +
          "不要贴着及格线设计：所有正文/次要文字以 7:1 以上为目标，强调文字与强调色以 7:1 以上为目标。" +
          "muted 仍是正文文字色：应接近 ink 的明度、只降低色度，绝不能取背景与 ink 之间的中间明度。" +
          "不要默认紫蓝 AI 渐变，不要三等分卡片，不要用视觉装饰掩盖信息。" +
          "字体只能从白名单选择；动效只能描述 transform/opacity 的节奏。" +
          "严格只输出 JSON，不要解释。",
        user:
          `课程：${input.courseTitle}\n` +
          `本节：${input.lessonTitle}\n` +
          (input.category ? `类别：${input.category}\n` : "") +
          (input.objective ? `目标：${input.objective}\n` : "") +
          (previous.length ? `此前章节设计（必须避开重复，但保持家族感）：\n- ${previous.join("\n- ")}\n` : "") +
          `本节内容：\n${content}\n\n` +
          "输出结构：" +
          '{"direction":"一句原创方向","palette":{"background":{"l":0-1,"c":0-0.32,"h":0-359},"surface":{},"ink":{},"muted":{},"accent":{},"accentInk":{}},' +
          '"font":"system-sans|editorial-serif|technical-mono|humanist-sans|rounded-sans","radiusPx":0-40,"gridColumns":1-12,"spacingUnit":4-24,' +
          '"motif":"与本节内容有关的视觉母题","layoutStrategy":"具体而不套模板的构图策略","motion":{"durationMs":120-1400,"easing":[x1,y1,x2,y2],"signature":"只用 transform/opacity 的动效节奏"}}。' +
          "正文与底色、正文与卡面、次要文字与两种底色均须 >=4.5:1；强调色与底色 >=3:1；强调文字与强调色 >=4.5:1。" +
          feedback,
        temperature: 0.9,
        maxTokens: 3200,
        timeoutMs: bespokeTimeoutMs(input.model),
        retries: 1,
        model: input.model.key,
        onUsage: creditingOnUsage(input.userId, "generate_lesson_html"),
      });
      const checked = validateCreativeDesign(raw);
      if (checked.ok && checked.design) return { design: checked.design, issues: [] };
      lastIssues = checked.issues;
      feedback = `\n上一版未通过安全可读性闸门。请保留方向但重新计算整套色板，所有对比度留出至少 1:1 安全余量：${lastIssues.join("；").slice(0, 900)}`;
    } catch (error) {
      lastIssues = [error instanceof Error ? error.message : "设计 Agent 调用失败"];
      feedback = `\n上一轮返回失败，请完整重做合法 JSON：${lastIssues.join("；").slice(0, 500)}`;
    }
  }
  return { design: null, issues: lastIssues };
}

/** 给 HTML 设计师的可信 token 注入。所有 CSS 值均来自已校验结构，不含自由 CSS。 */
export function creativeDesignPrompt(design: LessonCreativeDesign): string {
  const p = design.palette;
  const ease = `cubic-bezier(${design.motion.easing.join(",")})`;
  return (
    "【本节原创设计系统】以下 token 由设计 Agent 针对本节原创并已通过 WCAG 校验。它们不是平台皮肤。\n" +
    `方向：${design.direction}\n母题：${design.motif}\n构图：${design.layoutStrategy}\n动效：${design.motion.signature}\n` +
    `字体：${design.fontStack}；栅格 ${design.gridColumns} 列；基础间距 ${design.spacingUnit}px；圆角 ${design.radiusPx}px。\n` +
    "必须在 :root 原样声明并使用这些变量：" +
    `--cw-bg:${p.background.hex};--cw-surface:${p.surface.hex};--cw-ink:${p.ink.hex};--cw-muted:${p.muted.hex};` +
    `--cw-accent:${p.accent.hex};--cw-accent-ink:${p.accentInk.hex};--cw-radius:${design.radiusPx}px;` +
    `--cw-space:${design.spacingUnit}px;--cw-motion:${design.motion.durationMs}ms;--cw-ease:${ease};` +
    `--cw-font-body:${design.fontStack};--cw-font-display:${design.fontStack};\n` +
    "token 只定义设计语言，不规定页面骨架。请根据本节内容原创结构，不要复刻常见 hero+卡片网格。"
  );
}

/** 验证 HTML 确实采用了该节原创 token，防模型忽略设计 Agent 又回到自己的默认模板。 */
export function verifyCreativeDesignUsage(html: string, design: LessonCreativeDesign): string[] {
  const h = html.toLowerCase().replace(/\s+/g, "");
  const p = design.palette;
  const required: Array<[string, string]> = [
    ["--cw-bg", p.background.hex],
    ["--cw-surface", p.surface.hex],
    ["--cw-ink", p.ink.hex],
    ["--cw-muted", p.muted.hex],
    ["--cw-accent", p.accent.hex],
    ["--cw-accent-ink", p.accentInk.hex],
  ];
  const issues = required
    .filter(([name, value]) => !h.includes(`${name}:${value}`.toLowerCase()))
    .map(([name]) => `未原样声明原创 token ${name}`);
  const uses = (h.match(/var\(--cw-/g) || []).length;
  if (uses < 6) issues.push("原创 token 实际使用不足");
  return issues;
}
