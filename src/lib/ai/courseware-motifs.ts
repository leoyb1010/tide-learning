/**
 * 签名装饰母题（v3.4 · HTML 课件）—— 每个艺术方向一套**专属**的内联 SVG 装饰。
 *
 * 见桌面《下一轮工作文档》§2 P0：课件单调的根因之一是「零视觉资产」——全库只有文字 + 卡片，
 * 无插画/图形/母题。本模块给每个艺术方向一套确定性生成的签名 SVG，作 hero 页背景与分隔母题，
 * 让「一门课一套视觉世界」立得住，且同一门课翻页时构图有呼吸。
 *
 * 铁律：
 *  - 纯函数、seeded 确定性（同输入必同输出）、无随机源、无 IO；
 *  - 只产内联 SVG（CSP 禁外链，图像只能内联 SVG / data: / CSS 渐变）；
 *  - 颜色全部取自传入的 ArtDirection 确切 token（亮暗对比已在 design 层自校验）；
 *  - 装饰是**氛围层**：低透明、pointer-events:none、绝不夺文字可读性。
 */

import type { ArtDirection } from "./courseware-design";
import { hashSeed } from "./courseware-design";

/** 稳定取模挑选（复用 design 的 hashSeed 风格，避免引入随机）。 */
function pick(seed: number, mod: number): number {
  return seed % mod;
}

/**
 * Hero 页背景母题：铺满 section 底层的大幅签名图形（每方向独有）。
 * 返回一个绝对定位、pointer-events:none 的 <div>，内含一张 preserveAspectRatio=slice 的 SVG。
 * variant 由 seed 决定（每方向 2 个变体），使不同课/不同 hero 页不总是同一张。
 */
export function heroMotif(art: ArtDirection, seed: number): string {
  const a = art.accent;
  const b = art.border;
  const soft = art.accentSoft;
  const ink3 = art.ink3;
  const v = pick(seed, 2);
  let inner = "";

  switch (art.key) {
    case "editorial_paper":
      // 刊头细双线 + 印刷体星花，右上角一枚大号镂空序号感的圆弧。
      inner =
        `<g fill="none" stroke="${a}" stroke-opacity=".5">` +
        `<line x1="60" y1="86" x2="540" y2="86" stroke-width="1"/>` +
        `<line x1="60" y1="92" x2="540" y2="92" stroke-width="2"/>` +
        `</g>` +
        `<g fill="${a}" fill-opacity=".14">` +
        (v === 0
          ? `<path d="M300 250 l14 44 46 2 -37 28 14 44 -37-27 -37 27 14-44 -37-28 46-2z"/>`
          : `<circle cx="470" cy="300" r="90"/><circle cx="470" cy="300" r="60" fill="${art.bg}"/>`) +
        `</g>` +
        `<line x1="60" y1="470" x2="300" y2="470" stroke="${b}" stroke-width="1"/>`;
      break;
    case "dark_tech":
      // 发光节点网络 + 冷青扫描辉光。
      inner =
        `<defs><radialGradient id="g" cx="50%" cy="30%" r="70%">` +
        `<stop offset="0" stop-color="${a}" stop-opacity=".22"/><stop offset="1" stop-color="${a}" stop-opacity="0"/>` +
        `</radialGradient></defs>` +
        `<rect width="600" height="520" fill="url(#g)"/>` +
        `<g stroke="${a}" stroke-opacity=".28" stroke-width="1">` +
        `<path d="M80 120 L220 200 L360 140 L500 230"/><path d="M120 360 L260 300 L400 380 L520 320"/>` +
        `<path d="M220 200 L260 300"/><path d="M360 140 L400 380"/></g>` +
        `<g fill="${a}">` +
        [
          [80, 120],
          [220, 200],
          [360, 140],
          [500, 230],
          [120, 360],
          [260, 300],
          [400, 380],
          [520, 320],
        ]
          .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${v === 0 ? 4 : 3}" fill-opacity="${i % 2 ? 0.9 : 0.55}"/>`)
          .join("") +
        `</g>`;
      break;
    case "blueprint":
      // 坐标刻度 + 尺寸标注箭头（图纸感）。
      inner =
        `<g stroke="${a}" stroke-opacity=".5" stroke-width="1" fill="none">` +
        `<path d="M70 70 V450 M70 450 H520"/>` +
        Array.from({ length: 9 }, (_, i) => `<path d="M${70 + i * 50} 445 v10"/>`).join("") +
        Array.from({ length: 7 }, (_, i) => `<path d="M65 ${90 + i * 50} h10"/>`).join("") +
        `<path d="M120 120 H460" stroke-dasharray="2 4"/>` +
        `<path d="M120 114 v12 M460 114 v12"/>` +
        (v === 0 ? `<circle cx="300" cy="300" r="70" stroke-dasharray="4 6"/>` : `<rect x="230" y="230" width="140" height="140" stroke-dasharray="4 6"/>`) +
        `</g>`;
      break;
    case "soft_structure":
      // 柔和同心圆 / 偏移渐层，克制的银白氛围。
      inner =
        `<defs><radialGradient id="s" cx="72%" cy="22%" r="60%">` +
        `<stop offset="0" stop-color="${a}" stop-opacity=".16"/><stop offset="1" stop-color="${a}" stop-opacity="0"/>` +
        `</radialGradient></defs>` +
        `<rect width="600" height="520" fill="url(#s)"/>` +
        `<g fill="none" stroke="${a}" stroke-opacity=".16" stroke-width="1.5">` +
        (v === 0
          ? Array.from({ length: 5 }, (_, i) => `<circle cx="450" cy="150" r="${40 + i * 42}"/>`).join("")
          : Array.from({ length: 5 }, (_, i) => `<ellipse cx="300" cy="270" rx="${60 + i * 55}" ry="${40 + i * 34}"/>`).join("")) +
        `</g>`;
      break;
    case "scoreboard":
      // 斜切色块 + 幽灵大号数字（计分/冲刺高能）。
      inner =
        `<g>` +
        `<path d="M0 0 L200 0 L120 520 L0 520 Z" fill="${soft}"/>` +
        `<path d="M600 0 L600 160 L470 0 Z" fill="${a}" fill-opacity=".1"/>` +
        `<text x="430" y="430" font-family="ui-monospace, monospace" font-size="300" font-weight="800" fill="${a}" fill-opacity=".07" text-anchor="middle">${v === 0 ? "%" : "＃"}</text>` +
        `</g>`;
      break;
    case "cinematic_neon":
      // 电光辉光 + 对角光束 + 发光节点（发布会戏剧感）。
      inner =
        `<defs><radialGradient id="cn" cx="62%" cy="16%" r="76%">` +
        `<stop offset="0" stop-color="${a}" stop-opacity=".30"/><stop offset="1" stop-color="${a}" stop-opacity="0"/>` +
        `</radialGradient></defs>` +
        `<rect width="600" height="520" fill="url(#cn)"/>` +
        `<g stroke="${a}" stroke-opacity=".28" stroke-width="1.5">` +
        (v === 0 ? `<path d="M-20 170 L620 50"/><path d="M-20 250 L620 130"/>` : `<path d="M90 -20 L300 540"/><path d="M250 -20 L470 540"/>`) +
        `</g>` +
        `<g fill="${a}">` +
        [
          [120, 130],
          [470, 90],
          [300, 300],
          [520, 360],
        ]
          .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${v === 0 ? 4 : 3}" fill-opacity="${i % 2 ? 0.9 : 0.5}"/>`)
          .join("") +
        `</g>`;
      break;
    case "dev_terminal":
      // 终端窗口镜框 + 交通灯圆点 + 代码符号幽灵字。
      inner =
        `<g fill="none" stroke="${b}" stroke-width="1.5"><rect x="58" y="86" width="484" height="348" rx="8"/><line x1="58" y1="124" x2="542" y2="124"/></g>` +
        `<g fill="${a}"><circle cx="80" cy="105" r="5" fill-opacity=".7"/><circle cx="98" cy="105" r="5" fill-opacity=".45"/><circle cx="116" cy="105" r="5" fill-opacity=".25"/></g>` +
        `<g font-family="${art.fontMono}" fill="${a}" fill-opacity=".13" font-weight="700" font-size="46">` +
        (v === 0 ? `<text x="88" y="210">&lt;/&gt;</text><text x="88" y="290">$ _</text>` : `<text x="88" y="250">{ }</text><text x="300" y="330">=&gt;</text>`) +
        `</g>`;
      break;
    case "academic_lecture":
      // 页边栏竖线 + 刊头双细线 + 章节号 §（学院讲义）。
      inner =
        `<g stroke="${a}" stroke-opacity=".38"><line x1="92" y1="78" x2="92" y2="452"/><line x1="92" y1="120" x2="512" y2="120" stroke-width="2"/><line x1="92" y1="127" x2="512" y2="127"/></g>` +
        (v === 0
          ? `<text x="430" y="400" font-family="${art.fontDisplay}" font-size="120" fill="${a}" fill-opacity=".10">§</text>`
          : `<g stroke="${b}"><line x1="120" y1="210" x2="480" y2="210"/><line x1="120" y1="252" x2="440" y2="252"/><line x1="120" y1="294" x2="474" y2="294"/></g>`);
      break;
    case "storybook":
    default:
      // 有机 blob + 波浪丝带（绘本代入感）。
      inner =
        `<g fill="${soft}">` +
        (v === 0
          ? `<path d="M120 120 q60 -70 140 -30 q80 40 40 130 q-40 90 -140 60 q-100 -30 -40 -160z" opacity=".8"/>`
          : `<circle cx="150" cy="150" r="90" opacity=".7"/><circle cx="470" cy="360" r="70" opacity=".6"/>`) +
        `</g>` +
        `<path d="M0 400 q150 -60 300 0 t300 0" fill="none" stroke="${a}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>` +
        `<g fill="${a}" fill-opacity=".5">` +
        [
          [90, 300],
          [520, 180],
          [300, 110],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`)
          .join("") +
        `</g>`;
      break;
  }

  return (
    `<div class="sec-fig" aria-hidden="true">` +
    `<svg viewBox="0 0 600 520" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${inner}</svg>` +
    `</div>`
  );
}

/**
 * 角标母题：给 panel 类页型右上角一枚方向专属的小装饰（更细腻的品牌信号）。
 * 返回绝对定位、pointer-events:none 的小 SVG 容器。
 */
export function cornerMotif(art: ArtDirection): string {
  const a = art.accent;
  let inner: string;
  switch (art.key) {
    case "dark_tech":
      inner = `<g stroke="${a}" stroke-opacity=".5" fill="none"><path d="M4 20 L20 20 L20 4"/><circle cx="20" cy="20" r="2.5" fill="${a}"/></g>`;
      break;
    case "blueprint":
      inner = `<g stroke="${a}" stroke-opacity=".55" fill="none"><path d="M2 8 H22 M8 2 V22" stroke-dasharray="2 3"/></g>`;
      break;
    case "scoreboard":
      inner = `<path d="M2 2 L22 2 L22 14 Z" fill="${a}" fill-opacity=".5"/>`;
      break;
    case "editorial_paper":
      inner = `<g stroke="${a}" stroke-opacity=".5"><line x1="2" y1="6" x2="22" y2="6"/><line x1="2" y1="10" x2="22" y2="10"/></g>`;
      break;
    case "storybook":
      inner = `<circle cx="12" cy="12" r="6" fill="${a}" fill-opacity=".4"/>`;
      break;
    case "cinematic_neon":
      inner = `<g fill="${a}"><circle cx="12" cy="12" r="3.5" fill-opacity=".9"/><circle cx="12" cy="12" r="8" fill="none" stroke="${a}" stroke-opacity=".35"/></g>`;
      break;
    case "dev_terminal":
      inner = `<g font-family="${art.fontMono}" fill="${a}" fill-opacity=".6" font-size="16" font-weight="700"><text x="4" y="17">&gt;_</text></g>`;
      break;
    case "academic_lecture":
      inner = `<g stroke="${a}" stroke-opacity=".5"><line x1="3" y1="7" x2="21" y2="7" stroke-width="1.5"/><line x1="3" y1="11" x2="21" y2="11"/></g>`;
      break;
    default: // soft_structure
      inner = `<circle cx="12" cy="12" r="8" fill="none" stroke="${a}" stroke-opacity=".4"/>`;
  }
  return `<div class="sec-corner" aria-hidden="true"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${inner}</svg></div>`;
}

/** 供 UI/测试引用的母题种子（课内相邻 hero 页分化）。 */
export function motifSeed(courseId: string, key: string): number {
  return hashSeed(`motif:${courseId}:${key}`);
}
