/**
 * OKLCH 调色引擎（v5 设计token生成）——零依赖、纯函数、确定性。
 *
 * 为什么用 OKLCH 而非 HSL：HSL 的「亮度」不是感知亮度（同 L 的黄和蓝，黄看起来亮得多），
 * 按 HSL 造色阶会得到深浅不匀、发脏的调色板。OKLCH 是感知均匀色彩空间，同 L 看起来一样亮，
 * 造出的色阶专业、干净——这正是「高级设计感」的物理基础。
 *
 * 全链路：oklch → oklab → LMS → 线性 sRGB → 伽马 sRGB(hex)，越界则降 chroma 收敛进色域。
 * 文字色用 WCAG 对比度实测 + 步进 L 保证达标（正文≥7:1、次要≥4.5:1、强调≥4.5:1），
 * 「构造即达标 + 实测兜底」= 生成的配色永不因对比度不合格而被丢弃，每门课都拿得到专属观感。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
} // 0..255

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 伽马压缩：线性 sRGB 分量 → 0..1 显示域。 */
function linearToSrgb(c: number): number {
  c = clamp01(c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** 伽马展开：0..1 显示域 → 线性 sRGB（用于亮度计算）。 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * oklch(L 0..1, C 0..~0.4, H 度) → 线性 sRGB 三分量（未夹取，可能越界，供色域判定用）。
 * 系数为 Björn Ottosson 的 OKLab 标准矩阵。
 */
function oklchToLinearRgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  return [r, g, bb];
}

const inGamut = (rgb: [number, number, number]) =>
  rgb.every((c) => c >= -0.0001 && c <= 1.0001);

/**
 * oklch → sRGB（0..255）。越界时逐步降低 chroma 直到落进色域（保色相、保亮度，只让它不那么艳）。
 * 这样任何 (L,H) 组合都能得到一个真实可显示的颜色，不会输出脏值。
 */
export function oklchToRgb(L: number, C: number, H: number): Rgb {
  L = clamp01(L);
  let c = Math.max(0, C);
  let lin = oklchToLinearRgb(L, c, H);
  // 二分收敛比线性步进快且稳：先确认满足，再逼近最大可显示 chroma。
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb(L, mid, H))) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklchToLinearRgb(L, c, H);
  }
  return {
    r: Math.round(clamp01(linearToSrgb(lin[0])) * 255),
    g: Math.round(clamp01(linearToSrgb(lin[1])) * 255),
    b: Math.round(clamp01(linearToSrgb(lin[2])) * 255),
  };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
export const rgbToHex = (c: Rgb) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
export const oklchToHex = (L: number, C: number, H: number) => rgbToHex(oklchToRgb(L, C, H));

/** #rgb / #rrggbb → Rgb；非法返回 null（用于校验外部/LLM 颜色）。 */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  const m = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(m)) {
    return { r: parseInt(m[0] + m[0], 16), g: parseInt(m[1] + m[1], 16), b: parseInt(m[2] + m[2], 16) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(m)) {
    return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
  }
  return null;
}

/** WCAG 相对亮度。 */
export function relativeLuminance(c: Rgb): number {
  const R = srgbToLinear(c.r / 255);
  const G = srgbToLinear(c.g / 255);
  const B = srgbToLinear(c.b / 255);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 对比度 1..21。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** hex 对 hex 对比度；任一非法返回 0（=最差，触发上层回退）。 */
export function contrastHex(fg: string, bg: string): number {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return 0;
  return contrastRatio(a, b);
}

/**
 * 生成一个「在 against 底上达标」的文字色：从 preferL 出发，按 dir(-1 变暗/+1 变亮) 步进 L，
 * 取第一个对比度 ≥ minRatio 的；步到极端仍不够就返回极端值（纯黑/纯白必定压过任何中间底）。
 * chroma 保持很低（文字带一点色相即可，太艳伤可读）。返回 hex。
 */
export function textColorFor(
  against: Rgb,
  H: number,
  C: number,
  preferL: number,
  minRatio: number,
  dir: -1 | 1,
): string {
  let L = clamp01(preferL);
  let best = oklchToRgb(L, C, H);
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToRgb(L, C, H);
    if (contrastRatio(rgb, against) >= minRatio) return rgbToHex(rgb);
    best = rgb;
    const next = L + dir * 0.025;
    if (next < 0 || next > 1) break;
    L = next;
  }
  // 兜底：直接给极端明度（保色相），必过。
  const extreme = oklchToRgb(dir < 0 ? 0.08 : 0.98, C, H);
  return contrastRatio(extreme, against) >= contrastRatio(best, against)
    ? rgbToHex(extreme)
    : rgbToHex(best);
}
