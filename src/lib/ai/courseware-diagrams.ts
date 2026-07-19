/**
 * 语义图示渲染器(v4.3·leohtml 图示纪律落地)—— diagram 块的确定性渲染。
 *
 * 纪律(与装饰性插图 courseware-illustrations 的本质区别):
 *  - 结构取自关系:flow=顺序 / cycle=循环 / hub=中心与参与者 / layers=层级 / funnel=筛选转化;
 *  - 每个节点都有**来自内容的完整标签**(HTML 排版,CJK 换行友好;绝不用无标签圆圈/空盒子);
 *  - 方向显式(箭头/层叠语序),结果可见(flow/funnel 末项、hub 中心强调);
 *  - 全部吃 --ct-* design token → 12 套 art 自动换肤;纯字符串、零 IO、确定性。
 *
 * 揭示:容器带 data-stagger,翻页模式下节点逐个显形(动效即讲解顺序)。
 */

import type { Block } from "../blocks";

type DiagramBlock = Extract<Block, { type: "diagram" }>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 节点卡:标签 + 可选一行注(所有结构共用,保证图内文字风格一致)。 */
function node(item: { label: string; detail?: string }, cls = ""): string {
  return (
    `<div class="dg-node${cls ? ` ${cls}` : ""}"><span class="dg-label">${esc(item.label)}</span>` +
    (item.detail ? `<span class="dg-detail">${esc(item.detail)}</span>` : "") +
    `</div>`
  );
}

/** 右向箭头(SVG,继承 currentColor;竖排时靠 CSS 旋转)。 */
const ARROW =
  '<span class="dg-arrow" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 12h15m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

/** flow:顺序流程。节点→箭头→节点,末项=结果(强调)。宽屏横排,窄屏自动竖排。 */
function flow(d: DiagramBlock): string {
  const parts = d.items.map((it, i) => {
    const last = i === d.items.length - 1;
    return (i > 0 ? ARROW : "") + node(it, last ? "dg-node--result" : "");
  });
  return `<div class="dg-flow" data-stagger>${parts.join("")}</div>`;
}

/** cycle:循环运转。环形排布 + 环上箭头段;节点绝对定位(HTML 标签,CJK 稳)。 */
function cycle(d: DiagramBlock): string {
  const n = d.items.length;
  const cx = 50, cy = 50, rx = 38, ry = 36;
  // 环上箭头弧段:每段从上一节点角到下一节点角,留缺口;箭头头部用短折线画在弧末端切线方向。
  let arcs = "";
  for (let i = 0; i < n; i++) {
    const a0 = (-90 + (360 / n) * i + 16) * (Math.PI / 180);
    const a1 = (-90 + (360 / n) * (i + 1) - 16) * (Math.PI / 180);
    const x0 = cx + rx * Math.cos(a0), y0 = cy + ry * Math.sin(a0);
    const x1 = cx + rx * Math.cos(a1), y1 = cy + ry * Math.sin(a1);
    arcs += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rx} ${ry} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" class="dg-ring"/>`;
    // 箭头:弧末端切线方向的两短线
    const t = a1 + Math.PI / 2; // 顺时针切线
    const hx = x1, hy = y1, L = 3.4;
    const w1 = t - 0.5, w2 = t + 0.5;
    arcs += `<path d="M ${hx.toFixed(1)} ${hy.toFixed(1)} l ${(-L * Math.cos(w1)).toFixed(1)} ${(-L * Math.sin(w1)).toFixed(1)} M ${hx.toFixed(1)} ${hy.toFixed(1)} l ${(-L * Math.cos(w2)).toFixed(1)} ${(-L * Math.sin(w2)).toFixed(1)}" class="dg-ring dg-ring--head"/>`;
  }
  const nodes = d.items
    .map((it, i) => {
      const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = cx + rx * Math.cos(ang), y = cy + ry * Math.sin(ang);
      return `<div class="dg-cycle-node" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">${node(it)}</div>`;
    })
    .join("");
  return (
    `<div class="dg-cycle" data-stagger>` +
    `<svg class="dg-cycle-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>${arcs}</svg>` +
    nodes +
    `</div>`
  );
}

/** hub:中心与参与者。中心强调节点 + 辐条连线 + 周边参与者。items[0]=中心。 */
function hub(d: DiagramBlock): string {
  const [center, ...sats] = d.items;
  const n = sats.length;
  const cx = 50, cy = 50, rx = 40, ry = 37;
  let lines = "";
  const nodes = sats
    .map((it, i) => {
      const ang = (-90 + (360 / n) * i) * (Math.PI / 180);
      const x = cx + rx * Math.cos(ang), y = cy + ry * Math.sin(ang);
      lines += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="dg-spoke"/>`;
      return `<div class="dg-cycle-node" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">${node(it)}</div>`;
    })
    .join("");
  return (
    `<div class="dg-cycle dg-hub" data-stagger>` +
    `<svg class="dg-cycle-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>${lines}</svg>` +
    `<div class="dg-hub-center">${node(center, "dg-node--result")}</div>` +
    nodes +
    `</div>`
  );
}

/** layers:层级。自顶向下层叠,底层=基座(点缀强调)。 */
function layers(d: DiagramBlock): string {
  const rows = d.items
    .map((it, i) => {
      const last = i === d.items.length - 1;
      return `<div class="dg-layer${last ? " dg-layer--base" : ""}">${node(it)}</div>`;
    })
    .join("");
  return `<div class="dg-layers" data-stagger>${rows}</div>`;
}

/** funnel:筛选/转化。宽→窄,末项=转化结果(强调)。 */
function funnel(d: DiagramBlock): string {
  const n = d.items.length;
  const rows = d.items
    .map((it, i) => {
      const w = 100 - (i * 52) / Math.max(1, n - 1); // 100% → 48%
      const last = i === n - 1;
      return `<div class="dg-funnel-row${last ? " dg-funnel-row--out" : ""}" style="width:${w.toFixed(0)}%">${node(it, last ? "dg-node--result" : "")}</div>`;
    })
    .join("");
  return `<div class="dg-funnel" data-stagger>${rows}</div>`;
}

/** 渲染一个 diagram 块(不含外层 <section>;宿主页型与揭示由 courseware-html 统一编排)。 */
export function diagramHtml(d: DiagramBlock): string {
  const body =
    d.kind === "flow" ? flow(d)
    : d.kind === "cycle" ? cycle(d)
    : d.kind === "hub" ? hub(d)
    : d.kind === "layers" ? layers(d)
    : funnel(d);
  return (
    `<div class="dg">` +
    (d.title ? `<div class="dg-title">${esc(d.title)}</div>` : "") +
    body +
    (d.note ? `<div class="dg-note">${esc(d.note)}</div>` : "") +
    `</div>`
  );
}

/** diagram 块的 CSS(courseware-html 注入;全部 var(--ct-*),12 art 自动换肤)。 */
export const DIAGRAM_CSS = `
/* —— 语义图示(v4.3)—— */
.dg{margin:0}
.dg-title{font-size:15px;font-weight:700;color:var(--ct-ink);margin-bottom:14px;letter-spacing:.01em}
.dg-note{margin-top:14px;font-size:13.5px;color:var(--ct-ink2);border-left:3px solid var(--ct-accent);padding-left:10px;line-height:1.6}
.dg-node{display:flex;flex-direction:column;gap:3px;background:var(--ct-surface);border:1px solid var(--ct-border);
  border-radius:calc(var(--ct-radius) - 4px);padding:10px 13px;box-shadow:var(--ct-shadow);min-width:0}
.dg-label{font-size:14px;font-weight:700;color:var(--ct-ink);line-height:1.4}
.dg-detail{font-size:12px;color:var(--ct-ink3);line-height:1.5}
.dg-node--result{border-color:var(--ct-accent);background:var(--ct-accent-soft)}
.dg-node--result .dg-label{color:var(--ct-accent-ink)}
/* flow:横排,窄屏竖排(箭头旋转) */
.dg-flow{display:flex;align-items:stretch;gap:8px}
.dg-flow .dg-node{flex:1}
.dg-arrow{flex:none;display:grid;place-items:center;color:var(--ct-ink3)}
@media(max-width:560px){.dg-flow{flex-direction:column}.dg-arrow svg{transform:rotate(90deg)}}
/* cycle / hub:比例容器 + 绝对定位节点 */
.dg-cycle{position:relative;width:100%;max-width:560px;margin:0 auto;aspect-ratio:10/8}
.dg-cycle-ring{position:absolute;inset:0;width:100%;height:100%}
.dg-ring{fill:none;stroke:var(--ct-border);stroke-width:1.6;vector-effect:non-scaling-stroke}
.dg-ring--head{stroke:var(--ct-ink3);stroke-linecap:round}
.dg-spoke{stroke:var(--ct-border);stroke-width:1.4;vector-effect:non-scaling-stroke}
/* 居中用独立 translate 属性:揭示动效会把子项 transform 置 none,用 transform 居中会在揭示后飞位。 */
.dg-cycle-node{position:absolute;translate:-50% -50%;width:max-content;max-width:46%}
.dg-cycle-node .dg-node{padding:8px 11px}
.dg-hub-center{position:absolute;left:50%;top:50%;translate:-50% -50%;width:max-content;max-width:52%}
@media(max-width:560px){.dg-cycle{aspect-ratio:10/9}.dg-cycle-node{max-width:44%}.dg-label{font-size:13px}}
/* layers:自顶向下 */
.dg-layers{display:flex;flex-direction:column;gap:8px}
.dg-layer--base .dg-node{background:var(--ct-surface2);border-left:3px solid var(--ct-accent)}
/* funnel:居中收窄 */
.dg-funnel{display:flex;flex-direction:column;align-items:center;gap:8px}
.dg-funnel-row{min-width:200px}
.dg-funnel-row .dg-node{align-items:center;text-align:center}
`;
