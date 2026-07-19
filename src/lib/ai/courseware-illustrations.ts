/**
 * 确定性插图库（蓝图 B4 / 审查 P1-10「零图像课件」）—— image 块与视觉增强的参数化内联 SVG。
 *
 * 与 courseware-motifs（氛围装饰层）分工：母题是背景低透明纹样；本模块产**内容级插图**——
 * 概念关系图 / 流程箭头 / 比例环 / 迷你柱图 / 几何场景，作为 image 块的正身（此前渲染为文字占位）。
 *
 * 铁律与母题层一致：纯函数、seeded 确定性、只产内联 SVG、颜色全取 ArtDirection token、无 IO。
 * 插图族选择：caption 关键词强信号优先（流程/步骤→flow、占比/比例→ratio、对比/数据→bars、
 * 结构/关系/框架→map），否则按 seed 轮转，保证同课稳定、跨课分化。
 */

import type { ArtDirection } from "./courseware-design";
import { hashSeed } from "./courseware-design";

export type IllustrationKind = "map" | "flow" | "ratio" | "bars" | "scene";

const KIND_HINTS: Array<{ kind: IllustrationKind; re: RegExp }> = [
  { kind: "flow", re: /流程|步骤|顺序|路径|阶段|pipeline|flow/i },
  { kind: "ratio", re: /占比|比例|百分|份额|结构比|ratio/i },
  { kind: "bars", re: /对比|数据|统计|趋势|排行|chart|数量/i },
  { kind: "map", re: /关系|结构|框架|体系|图谱|组成|architecture|map/i },
];

export function pickIllustrationKind(caption: string | undefined, seed: number): IllustrationKind {
  if (caption) for (const h of KIND_HINTS) if (h.re.test(caption)) return h.kind;
  const pool: IllustrationKind[] = ["map", "flow", "ratio", "bars", "scene"];
  return pool[seed % pool.length];
}

/** 概念关系图：一核多象节点 + 连线。节点数/角度由 seed 决定。 */
function mapSvg(a: ArtDirection, seed: number): string {
  const n = 4 + (seed % 3); // 4-6 个卫星节点
  const cx = 200, cy = 110, R = 74;
  let nodes = "", links = "";
  for (let i = 0; i < n; i++) {
    const ang = ((seed % 360) / 57.3) + (i * Math.PI * 2) / n;
    const x = Math.round(cx + R * Math.cos(ang));
    const y = Math.round(cy + R * 0.72 * Math.sin(ang));
    links += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${a.border}" stroke-width="1.5"/>`;
    nodes += `<circle cx="${x}" cy="${y}" r="${i === seed % n ? 13 : 9}" fill="${i === seed % n ? a.accentSoft : a.surface}" stroke="${i === seed % n ? a.accent : a.border}" stroke-width="1.5"/>`;
  }
  return `${links}<circle cx="${cx}" cy="${cy}" r="20" fill="${a.accent}" opacity=".92"/><circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="${a.accentInk}" stroke-width="1.5"/>${nodes}`;
}

/** 流程箭头：3-4 级推进条 + 箭头。 */
function flowSvg(a: ArtDirection, seed: number): string {
  const n = 3 + (seed % 2);
  const w = 320 / n;
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = 30 + i * (w + 8);
    out += `<rect x="${x}" y="82" width="${w}" height="52" rx="${Math.min(a.radius, 12)}" fill="${i === n - 1 ? a.accentSoft : a.surface}" stroke="${i === n - 1 ? a.accent : a.border}" stroke-width="1.5"/>`;
    out += `<circle cx="${x + 16}" cy="${108}" r="7" fill="${a.accent}" opacity="${0.35 + (0.6 * (i + 1)) / n}"/>`;
    if (i < n - 1) out += `<path d="M ${x + w + 1} 108 l 7 0 m -3 -4 l 4 4 l -4 4" stroke="${a.accentInk}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

/** 比例环：主弧比例由 seed 决定（35%-80%），中心留白。 */
function ratioSvg(a: ArtDirection, seed: number): string {
  const pct = 35 + (seed % 46);
  const r = 56, c = 2 * Math.PI * r;
  const cx = 200, cy = 110;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a.border}" stroke-width="16"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a.accent}" stroke-width="16" stroke-linecap="round" ` +
    `stroke-dasharray="${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
    `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="${a.fontMono.replace(/"/g, "'")}" font-size="26" font-weight="700" fill="${a.ink}">${pct}%</text>`
  );
}

/** 迷你柱图：4-6 根柱，高度 seeded，末柱强调。 */
function barsSvg(a: ArtDirection, seed: number): string {
  const n = 4 + (seed % 3);
  const w = 26, gap = (340 - n * w) / (n + 1);
  let out = `<line x1="24" y1="168" x2="376" y2="168" stroke="${a.border}" stroke-width="1.5"/>`;
  for (let i = 0; i < n; i++) {
    const h = 34 + (hashSeed(`bar:${seed}:${i}`) % 92);
    const x = 24 + gap + i * (w + gap);
    const last = i === n - 1;
    out += `<rect x="${x.toFixed(1)}" y="${168 - h}" width="${w}" height="${h}" rx="4" fill="${last ? a.accent : a.surfaceAlt}" stroke="${last ? a.accentInk : a.border}" stroke-width="1"/>`;
  }
  return out;
}

/** 几何场景：分层圆/波（storybook/editorial 系的温和风景），按 substrate 调透明度。 */
function sceneSvg(a: ArtDirection, seed: number): string {
  const y = 130 + (seed % 24);
  return (
    `<circle cx="${290 + (seed % 40)}" cy="62" r="26" fill="${a.accentSoft}" stroke="${a.accent}" stroke-width="1.5"/>` +
    `<path d="M 20 ${y} Q 110 ${y - 44} 200 ${y} T 380 ${y}" fill="none" stroke="${a.accent}" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M 20 ${y + 22} Q 110 ${y - 18} 200 ${y + 22} T 380 ${y + 22}" fill="none" stroke="${a.border}" stroke-width="2"/>` +
    `<rect x="46" y="${y + 40}" width="70" height="8" rx="4" fill="${a.surfaceAlt}"/>` +
    `<rect x="46" y="${y + 54}" width="44" height="8" rx="4" fill="${a.surfaceAlt}"/>`
  );
}

/**
 * 生成一张内容级插图（自包含 SVG，宽度自适应容器）。
 * 供 image 块正身与后续视频分镜封面复用。
 */
export function illustrationSvg(art: ArtDirection, seed: number, caption?: string): string {
  const kind = pickIllustrationKind(caption, seed);
  const body =
    kind === "map" ? mapSvg(art, seed)
    : kind === "flow" ? flowSvg(art, seed)
    : kind === "ratio" ? ratioSvg(art, seed)
    : kind === "bars" ? barsSvg(art, seed)
    : sceneSvg(art, seed);
  return (
    `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" role="img" style="width:100%;height:auto;display:block">` +
    `<rect x="0" y="0" width="400" height="220" rx="${Math.min(art.radius, 16)}" fill="${art.surface}"/>` +
    body +
    `</svg>`
  );
}
