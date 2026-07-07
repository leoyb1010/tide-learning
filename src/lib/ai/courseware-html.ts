/**
 * HTML 课件渲染器 + 渲染契约 + 安全/反 slop 校验（v3.3）—— 服务端专用（用到 node:crypto）。
 *
 * 见计划文档：把「内容层 blocks」按「课级设计系统 × 场景级 Variance」渲染成**自包含、沙箱安全、有动效**的
 * HTML 课件，替代 14 种固定块的单调长相。本渲染器是**确定性引擎**：给定 (blocks, design, variance) 必产同一 HTML，
 * 零 LLM 依赖、零外链、零网络，天然可复现、可测、可截图验证。LLM 增强路径（可选）在生成路由里，
 * 产出 bespoke HTML 后仍要过本文件的 validateCoursewareHtml；不过则回落到本确定性渲染器；再不行回落 blocks。
 *
 * 安全铁律（见计划 §7）：产物含 CSP meta（head 第一个元素）、CSS/JS 全内联、无任何外链 URL、
 * 含 prefers-reduced-motion 分支、动画只动 transform/opacity。这些由 validateCoursewareHtml 机检。
 */

import { createHash } from "crypto";
import type { Block } from "../blocks";
import { renderMarkdown } from "../markdown";
import type { CourseDesign } from "./courseware-design";
import type { LessonVariance } from "./courseware-variance";
import { heroMotif, cornerMotif } from "./courseware-motifs";

export const HTML_CONTRACT_VERSION = 2; // v2: 内置翻页/滚动双模式运行时（默认翻页）

/** 渲染契约 DTO（web/iOS 共用；见计划 §6.3）。落库为 Lesson.htmlJson。 */
export interface CoursewareContract {
  renderMode: "sandbox_srcdoc";
  contractVersion: number;
  html: string;
  hasScript: boolean;
  checksum: string; // sha256:<hex>
}

/** CSP：写进 srcdoc head 第一个元素。default-src none 兜底；connect-src none 掐断外泄；只允许内联 + data: 图/字体。 */
export const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; ` +
  `connect-src 'none'; base-uri 'none'; form-action 'none'">`;

/**
 * 强制注入可信 CSP —— 用于 LLM 增强路径的产物。**绝不信任模型自带的 CSP**：
 * 剥离模型输出里任何 <meta http-equiv=Content-Security-Policy>，再把我方可信 CSP 作为 <head> 第一个元素注入。
 * 这样即便模型（或被作者内容诱导）想放宽策略/开外链外泄，运行时仍受我方 connect-src 'none' + img/font-src data: 约束。
 */
export function enforceTrustedCsp(html: string): string {
  const stripped = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy[^>]*>/gi, "");
  if (/<head[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head[^>]*>/i, (m) => `${m}${CSP_META}`);
  }
  // 无 <head>：直接前置（浏览器仍会把散落的 meta 提到 head 生效）。
  return CSP_META + stripped;
}

// ————————————————————————————————————————————————————————————
//  文本安全
// ————————————————————————————————————————————————————————————

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 块的 markdown 字段 → 安全 HTML（renderMarkdown 已做 HTML 转义，输出仅受控标签+class）。 */
function md(s: string): string {
  return renderMarkdown(s || "");
}

// ————————————————————————————————————————————————————————————
//  样式（CSS 变量 = 设计 token；动画 GPU 安全；reduce-motion 降级）
// ————————————————————————————————————————————————————————————

function baseCss(design: CourseDesign): string {
  const a = design.art;
  const dark = a.substrate === "dark";
  // 密度 → 区块垂直间距（macro 留白）；密度低 = 更大留白。
  const sectionGap = design.density <= 4 ? 88 : design.density <= 6 ? 64 : 48;
  // 卡片阴影：亮场用染色软阴影（低透明，非硬黑）；暗场用边框 + 内高光，几乎不用投影。
  const cardShadow = dark
    ? "0 0 0 1px var(--ct-border), inset 0 1px 0 rgba(255,255,255,.04)"
    : "0 1px 2px rgba(30,28,24,.05), 0 18px 40px -22px rgba(30,28,24,.09)";
  return `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --ct-bg:${a.bg};--ct-surface:${a.surface};--ct-surface2:${a.surfaceAlt};
  --ct-ink:${a.ink};--ct-ink2:${a.ink2};--ct-ink3:${a.ink3};--ct-border:${a.border};
  --ct-accent:${a.accent};--ct-accent-ink:${a.accentInk};--ct-accent-soft:${a.accentSoft};
  --ct-radius:${a.radius}px;--ct-ease:${a.ease};
  --ct-shadow:${cardShadow};
}
html{color-scheme:${dark ? "dark" : "light"};-webkit-text-size-adjust:100%}
body{background:var(--ct-bg);color:var(--ct-ink);
  font-family:${a.fontBody};line-height:1.68;font-size:16px;
  padding:clamp(20px,5vw,56px) clamp(16px,5vw,40px) 120px;}
/* 极淡纹理层：固定、pointer-events none，只做氛围（性能：不挂滚动容器） */
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  ${a.texture === "none" ? "" : `background-image:${a.texture};background-size:26px 26px;opacity:.5;`}}
.deck{max-width:${design.density <= 4 ? 720 : 760}px;margin:0 auto;display:flex;flex-direction:column;gap:${sectionGap}px}
.sec{position:relative}
/* —— 页型舞台（Page Archetype）：给每页一个「底」，翻页时构图有对比，破「全课一底色」—— */
.page{position:relative}
.page>section{position:relative;z-index:1}
.ct-fit{position:relative;z-index:1}
.page--band{background:var(--ct-accent-soft);border-radius:var(--ct-radius);padding:clamp(20px,4vw,34px)}
.page--surface{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);box-shadow:var(--ct-shadow);padding:clamp(20px,4vw,34px)}
.page--figure{background:var(--ct-surface2);border-left:3px solid var(--ct-accent);border-radius:var(--ct-radius);padding:clamp(20px,4vw,34px)}
/* 翻页模式：舞台已占满整页，内边距收紧给内容更多纵向空间（少触发缩放/滚动）。 */
body.ct-paged .page--band,body.ct-paged .page--surface,body.ct-paged .page--figure{padding:clamp(14px,2.6vh,24px)}
/* hero/plain 不加框：hero 承载全出血签名母题背景，plain 交给内容自身结构，形成留白节奏。 */
.sec-fig{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.sec-fig svg{width:100%;height:100%;display:block}
.sec-corner{position:absolute;top:14px;right:14px;width:24px;height:24px;z-index:0;pointer-events:none}
.sec-corner svg{width:100%;height:100%;display:block}
h1,h2,h3{font-family:${a.fontDisplay};font-weight:${a.displayWeight};letter-spacing:${a.displayTracking};line-height:1.14}
.eyebrow{font-family:${a.fontMono};font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ct-ink3);display:inline-block;margin-bottom:14px}
.lead{font-family:${a.fontDisplay};font-weight:${a.displayWeight};letter-spacing:${a.displayTracking};
  font-size:clamp(28px,5.2vw,46px);line-height:1.1;color:var(--ct-ink)}
.body{color:var(--ct-ink2);font-size:16.5px}
.body strong{color:var(--ct-ink);font-weight:650}
.card{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);
  box-shadow:var(--ct-shadow);padding:clamp(20px,4vw,32px)}
.card--alt{background:var(--ct-surface2)}
.accentbar{border-left:3px solid var(--ct-accent);padding-left:18px}
.pill{display:inline-flex;align-items:center;gap:6px;font-family:${a.fontMono};font-size:11px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ct-accent-ink);background:var(--ct-accent-soft);
  border-radius:999px;padding:5px 12px}
.h-title{font-size:clamp(20px,3.4vw,27px);color:var(--ct-ink);margin-bottom:14px}
.tide-md-h{font-family:${a.fontDisplay};color:var(--ct-ink);margin:12px 0 6px;font-size:19px}
.tide-md-pre{background:var(--ct-surface2);border:1px solid var(--ct-border);border-radius:calc(var(--ct-radius) - 4px);
  padding:14px 16px;overflow:auto;font-family:${a.fontMono};font-size:13.5px;color:var(--ct-ink);margin:10px 0}
code{font-family:${a.fontMono};font-size:.92em;background:var(--ct-surface2);padding:1px 6px;border-radius:6px}
ul,ol{padding-left:1.2em;color:var(--ct-ink2)}
li{margin:6px 0}
a{color:var(--ct-accent-ink)}
/* —— 场景开场 —— */
.opener{padding:clamp(28px,6vw,56px) 0}
.opener--band{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);
  box-shadow:var(--ct-shadow);padding:clamp(28px,5vw,48px)}
.opener--left{border-left:4px solid var(--ct-accent);padding-left:clamp(20px,4vw,32px)}
/* —— objectives —— */
.obj{list-style:none;padding:0;display:grid;gap:12px}
.obj li{display:flex;gap:12px;align-items:flex-start;color:var(--ct-ink)}
.obj .dot{flex:none;width:22px;height:22px;border-radius:50%;background:var(--ct-accent-soft);color:var(--ct-accent-ink);
  display:grid;place-items:center;font-family:${a.fontMono};font-size:11px;margin-top:2px}
/* —— steps —— */
.steps{list-style:none;padding:0;display:grid;gap:0}
.steps li{display:grid;grid-template-columns:auto 1fr;gap:16px;padding-bottom:22px;position:relative}
.steps li:last-child{padding-bottom:0}
.steps .n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--ct-accent);color:#fff;
  display:grid;place-items:center;font-family:${a.fontMono};font-weight:700;font-size:13px;z-index:1}
.steps li:not(:last-child)::before{content:"";position:absolute;left:15px;top:30px;bottom:0;width:2px;background:var(--ct-border)}
.steps .st{font-weight:650;color:var(--ct-ink);font-size:16.5px}
.steps .sd{color:var(--ct-ink2);font-size:15px;margin-top:3px}
.steps--cards li{grid-template-columns:1fr;background:var(--ct-surface);border:1px solid var(--ct-border);
  border-radius:var(--ct-radius);padding:16px 18px;margin-bottom:12px}
.steps--cards li::before{display:none}
/* —— compare —— */
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cmp--stacked{grid-template-columns:1fr}
.cmp .col{border-radius:var(--ct-radius);padding:18px;border:1px solid var(--ct-border)}
.cmp .wrong{background:var(--ct-surface2)}
.cmp .right{background:var(--ct-accent-soft);border-color:var(--ct-accent)}
.cmp h4{font-family:${a.fontBody};font-size:13px;letter-spacing:.04em;margin-bottom:10px;color:var(--ct-ink2)}
.cmp .right h4{color:var(--ct-accent-ink)}
.cmp ul{list-style:none;padding:0}
.cmp li{padding-left:16px;position:relative}
.cmp li::before{content:"";position:absolute;left:0;top:10px;width:6px;height:6px;border-radius:50%;background:var(--ct-ink3)}
.cmp .right li::before{background:var(--ct-accent)}
/* —— dialog —— */
.dlg{display:grid;gap:12px}
.turn{max-width:82%}
.turn .who{font-family:${a.fontMono};font-size:11px;color:var(--ct-ink3);margin:0 4px 4px}
.turn .bub{border-radius:16px;padding:11px 15px;font-size:15.5px;line-height:1.6}
.turn.l .bub{background:var(--ct-surface2);border:1px solid var(--ct-border);border-top-left-radius:5px}
.turn.r{margin-left:auto}
.turn.r .bub{background:var(--ct-accent-soft);border:1px solid var(--ct-accent);border-top-right-radius:5px;color:var(--ct-ink)}
.turn.r .who{text-align:right}
.turn .note{font-size:12.5px;font-style:italic;color:var(--ct-ink3);margin:4px 6px 0}
/* —— keypoint —— */
.kp{display:grid;gap:10px;grid-template-columns:1fr 1fr}
.kp--list{grid-template-columns:1fr}
.kp .item{display:flex;gap:10px;align-items:flex-start;background:var(--ct-surface);border:1px solid var(--ct-border);
  border-radius:calc(var(--ct-radius) - 4px);padding:12px 14px;font-size:15px}
.kp .item .b{flex:none;width:20px;height:20px;border-radius:6px;background:var(--ct-accent-soft);color:var(--ct-accent-ink);
  display:grid;place-items:center;font-family:${a.fontMono};font-size:11px;margin-top:1px}
/* —— quiz —— */
.quiz .q{font-weight:650;color:var(--ct-ink);font-size:17px;margin-bottom:14px}
.quiz .opts{display:grid;gap:9px}
.quiz .opt{display:flex;justify-content:space-between;gap:12px;text-align:left;width:100%;cursor:pointer;
  background:var(--ct-surface2);border:1px solid var(--ct-border);border-radius:calc(var(--ct-radius) - 4px);
  padding:13px 15px;font:inherit;font-size:15px;color:var(--ct-ink);transition:border-color .25s var(--ct-ease),transform .2s var(--ct-ease)}
.quiz .opt:hover{border-color:var(--ct-accent)}
.quiz .opt:active{transform:scale(.99)}
.quiz .opt .mk{font-family:${a.fontMono};font-size:12px;color:var(--ct-ink3);opacity:0}
.quiz .opt.ok{border-color:#1f9e6e;background:${dark ? "#0f2620" : "#e7f6ef"}}
.quiz .opt.ok .mk{opacity:1;color:#1f9e6e}
.quiz .opt.no{border-color:var(--ct-accent);background:var(--ct-accent-soft)}
.quiz .opt.no .mk{opacity:1;color:var(--ct-accent-ink)}
.quiz .exp{margin-top:12px;font-size:14.5px;color:var(--ct-ink2);background:var(--ct-surface2);
  border-radius:calc(var(--ct-radius) - 4px);padding:12px 14px;display:none}
.quiz.answered .exp{display:block}
/* —— flashcard —— */
.fc{perspective:1200px;cursor:pointer}
.fc .inner{position:relative;transition:transform .6s var(--ct-ease);transform-style:preserve-3d;min-height:120px}
.fc.flip .inner{transform:rotateY(180deg)}
.fc .face{position:absolute;inset:0;backface-visibility:hidden;background:var(--ct-surface);border:1px solid var(--ct-border);
  border-radius:var(--ct-radius);box-shadow:var(--ct-shadow);padding:22px;display:flex;flex-direction:column;justify-content:center}
.fc .back{transform:rotateY(180deg);background:var(--ct-accent-soft);border-color:var(--ct-accent)}
.fc .lab{font-family:${a.fontMono};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ct-ink3);margin-bottom:8px}
.fc .back .lab{color:var(--ct-accent-ink)}
.fc .t{font-size:17px;color:var(--ct-ink);font-weight:600}
/* —— callout / summary —— */
.callout{display:flex;gap:12px;border-radius:var(--ct-radius);padding:16px 18px;border:1px solid var(--ct-border)}
.callout.info{background:${dark ? "#0f1e33" : "#e9f0ff"};border-color:${dark ? "#22406b" : "#c4d6ff"}}
.callout.warn{background:${dark ? "#2a2210" : "#faf2e0"};border-color:${dark ? "#5a4a1c" : "#ecdca6"}}
.callout .ic{flex:none;font-family:${a.fontMono};font-size:12px;color:var(--ct-ink2)}
.summary{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);
  box-shadow:var(--ct-shadow);overflow:hidden}
.summary .top{padding:clamp(20px,4vw,30px)}
.summary .next{border-top:1px solid var(--ct-border);background:var(--ct-surface2);padding:14px clamp(20px,4vw,30px);
  font-size:14.5px;color:var(--ct-accent-ink)}
.summary .next b{font-family:${a.fontMono};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ct-ink3);margin-right:8px}
/* —— example / image —— */
.ex{border-left:3px solid var(--ct-accent);background:var(--ct-surface2);border-radius:var(--ct-radius);
  padding:18px 20px;position:relative}
.ex .tag{font-family:${a.fontMono};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ct-ink3);margin-bottom:8px;display:block}
.img-ph{background:var(--ct-surface2);border:1px dashed var(--ct-border);border-radius:var(--ct-radius);
  padding:30px;text-align:center;color:var(--ct-ink3);font-size:14px}
/* —— 入场动效（GPU 安全：只动 transform/opacity）—— */
[data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .7s var(--ct-ease),transform .7s var(--ct-ease)}
[data-reveal].m-fade{transform:none}
[data-reveal].m-scale{transform:scale(.96)}
[data-reveal].in{opacity:1;transform:none}
[data-stagger]>*{opacity:0;transform:translateY(14px);transition:opacity .55s var(--ct-ease),transform .55s var(--ct-ease)}
[data-stagger].in>*{opacity:1;transform:none}
[data-stagger].in>*{transition-delay:calc(var(--i,0) * 80ms)}
@media (prefers-reduced-motion: reduce){
  [data-reveal],[data-stagger]>*{opacity:1!important;transform:none!important;transition:none!important}
  .fc .inner{transition:none}
}
@media (max-width:640px){
  .cmp,.kp{grid-template-columns:1fr}
  .turn{max-width:92%}
}
/* —— 翻页模式（默认；body.ct-paged 由运行时切换，父页可发 ct-mode 覆盖）——
   每个 .deck>section 即一页：单屏居中呈现，超高内容由 .ct-fit 等比缩放到一屏（不滚）。 */
body.ct-paged{height:100vh;overflow:hidden;padding:0}
body.ct-paged .deck{height:100%;max-width:880px;display:block;padding:clamp(16px,3.5vh,32px) clamp(18px,4.5vw,44px) 78px}
body.ct-paged .deck>section{display:none;height:100%}
body.ct-paged .deck>section.ct-cur{display:grid;place-items:center;overflow:hidden}
/* 缩到下限仍超高的页：改为本页内部纵向滚动 + 顶对齐，绝不裁切内容（长 steps/quiz/代码块保底可读）。 */
body.ct-paged .deck>section.ct-cur.ct-scroll{place-items:start center;overflow-y:auto;overflow-x:hidden}
body.ct-paged .deck>section.ct-cur.ct-scroll .ct-fit{padding-bottom:10px}
.ct-fit{width:100%;transform-origin:center center}
body.ct-paged .ct-fit{transition:transform .28s var(--ct-ease)}
.ct-progress{position:fixed;top:0;left:0;height:3px;width:0;z-index:7;display:none;background:var(--ct-accent);transition:width .35s var(--ct-ease)}
body.ct-paged .ct-progress{display:block}
.ct-pager{position:fixed;left:0;right:0;bottom:0;z-index:6;display:none;align-items:center;justify-content:center;gap:14px;
  padding:14px clamp(16px,4vw,40px) 16px;background:linear-gradient(to top,var(--ct-bg) 55%,transparent)}
body.ct-paged .ct-pager{display:flex}
.ct-pager button{font:inherit;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
  height:38px;min-width:44px;padding:0 16px;border-radius:999px;border:1px solid var(--ct-border);
  background:var(--ct-surface);color:var(--ct-ink2);
  transition:border-color .2s var(--ct-ease),color .2s var(--ct-ease),transform .15s var(--ct-ease)}
.ct-pager button:hover{border-color:var(--ct-accent);color:var(--ct-ink)}
.ct-pager button:active{transform:scale(.97)}
.ct-pager button[disabled]{opacity:.35;cursor:default;pointer-events:none}
.ct-pager .ct-count{font-family:${a.fontMono};font-size:12px;letter-spacing:.12em;color:var(--ct-ink3);min-width:64px;text-align:center}
@media (prefers-reduced-motion: reduce){
  body.ct-paged .ct-fit,.ct-progress{transition:none}
}
`;
}

// ————————————————————————————————————————————————————————————
//  运行时脚本（入场观察 + 交互 + 向父窗上报高度）—— 纯本地、无网络、无原生桥
// ————————————————————————————————————————————————————————————

const RUNTIME_SCRIPT = `
(function(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var secs = Array.prototype.slice.call(document.querySelectorAll('main.deck > section'));
  var mode = 'paged'; // 默认翻页；父页可发 {type:'ct-mode', mode:'scroll'} 切竖向长滚动
  var cur = 0;

  // 每页内容包进 .ct-fit，供翻页模式等比缩放到一屏（transform 不改布局，滚动模式零影响）。
  // 全出血装饰层（.sec-fig/.sec-corner）保留为 section 直接子级：不随内容缩放/居中，始终铺满整页作背景母题。
  secs.forEach(function(s){
    var w = document.createElement('div'); w.className = 'ct-fit';
    var kids = [];
    for (var k = 0; k < s.childNodes.length; k++) kids.push(s.childNodes[k]);
    kids.forEach(function(n){
      if (n.nodeType === 1 && n.classList && (n.classList.contains('sec-fig') || n.classList.contains('sec-corner'))) return;
      w.appendChild(n);
    });
    s.appendChild(w);
  });

  // 翻页控件（顶部进度条 + 底部 上一页/页码/下一页）；滚动模式下由 CSS 隐藏。
  var progress = document.createElement('div'); progress.className = 'ct-progress';
  document.body.appendChild(progress);
  var pager = null, prevBtn = null, nextBtn = null, count = null;
  if (secs.length > 1) {
    pager = document.createElement('div'); pager.className = 'ct-pager';
    prevBtn = document.createElement('button'); prevBtn.type = 'button'; prevBtn.textContent = '\\u2039 上一页'; prevBtn.setAttribute('aria-label','上一页');
    count = document.createElement('span'); count.className = 'ct-count';
    nextBtn = document.createElement('button'); nextBtn.type = 'button'; nextBtn.textContent = '下一页 \\u203a'; nextBtn.setAttribute('aria-label','下一页');
    pager.appendChild(prevBtn); pager.appendChild(count); pager.appendChild(nextBtn);
    document.body.appendChild(pager);
    prevBtn.addEventListener('click', function(){ nav(-1); });
    nextBtn.addEventListener('click', function(){ nav(1); });
  }

  function reveal(){
    var els = document.querySelectorAll('[data-reveal],[data-stagger]');
    if(reduce || !('IntersectionObserver' in window)){ els.forEach(function(e){e.classList.add('in');}); return; }
    // 翻页模式下隐藏页不相交；翻到某页其元素才相交入场 —— 同一个 IO 天然兼容两种模式。
    var io = new IntersectionObserver(function(ents){
      ents.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
    },{rootMargin:'0px 0px -8% 0px',threshold:.08});
    els.forEach(function(e){ io.observe(e); });
  }
  function quiz(){
    document.querySelectorAll('.quiz').forEach(function(q){
      var ans = parseInt(q.getAttribute('data-answer'),10);
      q.querySelectorAll('.opt').forEach(function(opt,i){
        opt.addEventListener('click',function(){
          if(q.classList.contains('answered')) return;
          q.classList.add('answered');
          q.querySelectorAll('.opt').forEach(function(o,j){ if(j===ans) o.classList.add('ok'); });
          if(i!==ans) opt.classList.add('no');
        });
      });
    });
  }
  function cards(){
    document.querySelectorAll('.fc').forEach(function(c){
      c.addEventListener('click',function(){ c.classList.toggle('flip'); });
    });
  }
  function postHeight(){
    if (mode === 'paged') return; // 翻页模式高度由父页固定，不上报
    try{
      var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      parent.postMessage({type:'ct-height', height:h}, '*');
    }catch(e){}
  }
  // 超高页处理：轻度超高→等比缩到一屏；重度超高（缩到 0.6 下限仍放不下）→本页内部滚动，绝不裁切。
  // 先复位（清 transform + ct-scroll）再量自然高度。
  function fit(){
    if (mode !== 'paged') return;
    var s = secs[cur]; if (!s) return;
    var w = s.querySelector('.ct-fit'); if (!w) return;
    w.style.transform = '';
    s.classList.remove('ct-scroll');
    var avail = s.clientHeight, natural = w.scrollHeight;
    if (avail <= 0 || natural <= avail) return; // 一屏放得下
    var ideal = avail / natural;
    if (ideal >= 0.56) { w.style.transform = 'scale(' + ideal.toFixed(3) + ')'; }
    else { s.classList.add('ct-scroll'); } // 缩到下限仍超高 → 本页可滚（顶对齐），内容不丢
  }
  function show(i){
    if (!secs.length) return;
    cur = Math.max(0, Math.min(secs.length - 1, i));
    secs.forEach(function(s, j){ s.classList[j === cur ? 'add' : 'remove']('ct-cur'); });
    // 翻页模式下不能只靠 IntersectionObserver（页在 display:none↔显示间切换时不可靠）：
    // 每次翻到某页，显式给该页的入场元素加 .in（既保证可见，又让每页翻入时重放一次入场动效）。
    if (!reduce) {
      var cw = secs[cur].querySelectorAll('[data-reveal],[data-stagger]');
      for (var q = 0; q < cw.length; q++) cw[q].classList.add('in');
    }
    if (prevBtn) { prevBtn.disabled = cur === 0; nextBtn.disabled = cur === secs.length - 1; }
    if (count) count.textContent = (cur + 1) + ' / ' + secs.length;
    progress.style.width = (((cur + 1) / secs.length) * 100) + '%';
    fit();
    try{ parent.postMessage({type:'ct-page', index: cur, total: secs.length}, '*'); }catch(e){}
  }
  function nav(d){ if (mode === 'paged') show(cur + d); }
  function setMode(m){
    if (m !== 'paged' && m !== 'scroll') return;
    mode = m;
    document.body.classList[m === 'paged' ? 'add' : 'remove']('ct-paged');
    if (m === 'paged') { show(cur); }
    else {
      secs.forEach(function(s){
        s.classList.remove('ct-cur');
        var w = s.querySelector('.ct-fit'); if (w) w.style.transform = '';
        // 滚动模式内容即刻可见（IO 已 unobserve 的元素不会再触发）。
        s.querySelectorAll('[data-reveal],[data-stagger]').forEach(function(e){ e.classList.add('in'); });
        if (s.hasAttribute('data-reveal')) s.classList.add('in');
      });
      postHeight();
    }
  }

  // 键盘翻页（iframe 获焦时）；父页也会转发 ct-nav 兜没获焦的场景。
  window.addEventListener('keydown', function(e){
    if (mode !== 'paged') return;
    var tag = ((e.target && e.target.tagName) || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if ((e.key === ' ' || e.key === 'Spacebar') && tag !== 'BUTTON') { e.preventDefault(); nav(1); }
  });
  // 能力宣告：父页可能晚于本脚本挂监听（SSR 下 iframe 先于 hydration 加载），
  // 故初始 + 延时重播 + 响应父页 ct-hello 握手，三路保证父页必收到。
  function announce(){
    try{ parent.postMessage({type:'ct-ready', pages: secs.length, contract: 2}, '*'); }catch(e){}
  }
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'ct-mode') setMode(d.mode);
    else if (d.type === 'ct-nav') nav(d.dir === -1 ? -1 : 1);
    else if (d.type === 'ct-hello') announce();
  });

  reveal(); quiz(); cards();
  setMode('paged');
  announce();
  window.addEventListener('load', function(){ postHeight(); fit(); });
  if('ResizeObserver' in window){
    var ro = new ResizeObserver(function(){ postHeight(); fit(); });
    ro.observe(document.body);
    secs.forEach(function(s){ var w = s.querySelector('.ct-fit'); if (w) ro.observe(w); });
  }
  setTimeout(function(){ announce(); postHeight(); fit(); }, 400);
  setTimeout(function(){ announce(); postHeight(); fit(); }, 1200);
})();
`;

// ————————————————————————————————————————————————————————————
//  单块渲染（按 variance 选版式）
// ————————————————————————————————————————————————————————————

type IdBlock = Block & { id: string };

function revealAttr(v: LessonVariance, i: number): string {
  const m = v.motionSet[i % v.motionSet.length];
  const cls = m === "reveal-fade" ? "m-fade" : m === "scale-in" ? "m-scale" : "";
  return `data-reveal class="${cls}"`;
}

function renderBlock(b: IdBlock, i: number, design: CourseDesign, v: LessonVariance): string {
  const rv = revealAttr(v, i);
  const variant = v.variantForBlock(b.type, i);
  switch (b.type) {
    case "scene": {
      const cls = variant === "hero-band" ? "opener opener--band" : variant === "hero-left" ? "opener opener--left" : "opener";
      return `<section ${rv}><div class="${cls}"><span class="eyebrow">场景 · 为什么学</span>
        ${b.title ? `<h1 class="lead">${esc(b.title)}</h1>` : ""}
        ${b.markdown ? `<div class="body" style="margin-top:18px;max-width:60ch">${md(b.markdown)}</div>` : ""}</div></section>`;
    }
    case "objectives":
      return `<section ${rv}><span class="eyebrow">本节你将学会</span>
        <ul class="obj" data-stagger>${b.items
          .map((it, k) => `<li style="--i:${k}"><span class="dot">${k + 1}</span><span>${esc(it)}</span></li>`)
          .join("")}</ul></section>`;
    case "concept": {
      if (variant === "big-lead") {
        return `<section ${rv}>${b.title ? `<h2 class="lead" style="font-size:clamp(24px,4vw,36px)">${esc(b.title)}</h2>` : ""}
          <div class="body" style="margin-top:16px;max-width:62ch">${md(b.markdown)}</div></section>`;
      }
      const inner = `${b.title ? `<h3 class="h-title">${esc(b.title)}</h3>` : ""}<div class="body">${md(b.markdown)}</div>`;
      if (variant === "framed") return `<section ${rv}><div class="card">${inner}</div></section>`;
      if (variant === "split-note")
        return `<section ${rv}><div class="card card--alt"><span class="pill">概念</span><div style="margin-top:12px">${inner}</div></div></section>`;
      return `<section ${rv}><div class="accentbar">${inner}</div></section>`; // accent-bar
    }
    case "example": {
      const inner = `<span class="tag">例</span><div class="body" style="color:var(--ct-ink)">${md(b.markdown)}</div>`;
      if (variant === "inline-mark")
        return `<section ${rv}><div class="accentbar" style="border-left-width:3px">${inner}</div></section>`;
      return `<section ${rv}><div class="ex">${inner}</div></section>`;
    }
    case "steps": {
      const cards = variant === "numbered-cards";
      return `<section ${rv}><span class="eyebrow">操作步骤</span>
        <ol class="steps ${cards ? "steps--cards" : ""}" data-stagger>${b.steps
          .map(
            (s, k) =>
              `<li style="--i:${k}"><span class="n">${k + 1}</span><div><div class="st">${esc(s.title)}</div>${
                s.detail ? `<div class="sd">${esc(s.detail)}</div>` : ""
              }</div></li>`,
          )
          .join("")}</ol></section>`;
    }
    case "compare": {
      const stacked = variant === "stacked";
      const col = (heading: string, items: string[], right: boolean) =>
        `<div class="col ${right ? "right" : "wrong"}"><h4>${esc(heading)}</h4><ul>${items
          .map((it) => `<li>${esc(it)}</li>`)
          .join("")}</ul></div>`;
      return `<section ${rv}>${b.title ? `<span class="eyebrow">${esc(b.title)}</span>` : `<span class="eyebrow">对比辨析</span>`}
        <div class="cmp ${stacked ? "cmp--stacked" : ""}">${col(b.left.heading || "常见误区", b.left.items, false)}${col(
          b.right.heading || "正确做法",
          b.right.items,
          true,
        )}</div></section>`;
    }
    case "dialog": {
      const order: string[] = [];
      for (const t of b.turns) if (!order.includes(t.speaker)) order.push(t.speaker);
      return `<section ${rv}><span class="eyebrow">对话示例</span>
        <div class="dlg" data-stagger>${b.turns
          .map((t, k) => {
            const right = order.indexOf(t.speaker) % 2 === 1;
            return `<div class="turn ${right ? "r" : "l"}" style="--i:${k}"><div class="who">${esc(t.speaker)}</div>
              <div class="bub">${esc(t.text)}</div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}</div>`;
          })
          .join("")}</div></section>`;
    }
    case "keypoint":
      return `<section ${rv}><span class="eyebrow">本节要点</span>
        <div class="kp ${variant === "checklist" ? "kp--list" : ""}" data-stagger>${b.points
          .map((p, k) => `<div class="item" style="--i:${k}"><span class="b">${k + 1}</span><span>${esc(p)}</span></div>`)
          .join("")}</div></section>`;
    case "callout":
      return `<section ${rv}><div class="callout ${b.tone === "warn" ? "warn" : "info"}"><span class="ic">${
        b.tone === "warn" ? "!" : "i"
      }</span><div class="body" style="color:var(--ct-ink)">${md(b.markdown)}</div></div></section>`;
    case "code":
      return `<section ${rv}><div class="card"><span class="pill">${esc(b.lang || "code")}</span>
        <pre class="tide-md-pre" style="margin-top:12px">${esc(b.code)}</pre>${
          b.explanation ? `<div class="body" style="margin-top:10px">${esc(b.explanation)}</div>` : ""
        }</div></section>`;
    case "quiz":
      return `<section ${rv}><div class="card quiz" data-answer="${b.answerIndex}"><span class="pill">随堂测</span>
        <div class="q" style="margin-top:12px">${esc(b.question)}</div>
        <div class="opts">${b.options
          .map((o) => `<button class="opt"><span>${esc(o)}</span><span class="mk">●</span></button>`)
          .join("")}</div>
        <div class="exp">${esc(b.explain)}</div></div></section>`;
    case "flashcard":
      return `<section ${rv}><div class="fc"><div class="inner">
        <div class="face front"><span class="lab">记忆卡 · 点击翻面</span><div class="t">${esc(b.front)}</div></div>
        <div class="face back"><span class="lab">答案</span><div class="t">${esc(b.back)}</div></div>
      </div></div></section>`;
    case "summary":
      return `<section ${rv}><div class="summary"><div class="top"><span class="pill">本节小结</span>
        <div class="body" style="margin-top:12px;color:var(--ct-ink)">${md(b.markdown)}</div></div>
        ${b.next ? `<div class="next"><b>下一节</b>${esc(b.next)}</div>` : ""}</div></section>`;
    case "image":
      // 沙箱 CSP 禁外链，站内图无法直接加载；渲染优雅占位（有 caption 显 caption），不留破图、不外泄。
      return `<section ${rv}><div class="img-ph">${esc(b.caption || b.alt || "图解")}</div></section>`;
    default:
      return "";
  }
}

// ————————————————————————————————————————————————————————————
//  组装完整文档
// ————————————————————————————————————————————————————————————

export interface RenderInput {
  title: string;
  blocks: IdBlock[];
  design: CourseDesign;
  variance: LessonVariance;
}

// —— 页型档案（Page Archetype）：给每个 block 的整页一个「舞台」，翻页时构图有对比 ——
// 打破「每页都是 小字→标题→段落→卡片 的同底色纵向堆叠」。scene/summary 为情绪书挡 → hero 母题背景；
// 其余按 (seed+index) 确定性在 band/surface/figure/plain 间轮转，且不与相邻页同型（保证翻页视觉分化）。
const STAGE_POOL = ["band", "surface", "figure", "plain"] as const;
type Stage = (typeof STAGE_POOL)[number] | "hero";

function stageFor(type: string, i: number, seed: number, prev: Stage | null): Stage {
  if (type === "scene" || type === "summary") return "hero";
  let s: Stage = STAGE_POOL[(seed + i) % STAGE_POOL.length];
  if (s === prev) s = STAGE_POOL[(seed + i + 1) % STAGE_POOL.length];
  return s;
}

/** 确定性渲染：给定输入必产同一自包含 HTML（含 CSP、内联样式脚本、reduce-motion、页型舞台+签名母题）。 */
export function renderCoursewareHtml(input: RenderInput): string {
  const { title, blocks, design, variance } = input;
  let prev: Stage | null = null;
  const body = blocks
    .map((b, i) => {
      const stage = stageFor(b.type, i, variance.seed >>> 0, prev);
      prev = stage;
      // 全出血装饰层（不随内容缩放，见运行时 wrapping 保留逻辑）：hero 用大幅母题背景，figure 用角标。
      const deco = stage === "hero" ? heroMotif(design.art, (variance.seed + i) >>> 0) : stage === "figure" ? cornerMotif(design.art) : "";
      return `<section class="page page--${stage}">${deco}${renderBlock(b, i, design, variance)}</section>`;
    })
    .join("\n");
  return (
    `<!doctype html><html lang="zh-CN"><head>${CSP_META}` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>${baseCss(design)}</style></head>` +
    `<body><main class="deck">${body}</main><script>${RUNTIME_SCRIPT}</script></body></html>`
  );
}

/** 包成渲染契约 DTO（含 sha256 校验和；hasScript 恒 true，因含入场/交互/高度上报脚本）。 */
export function buildContract(html: string): CoursewareContract {
  const checksum = "sha256:" + createHash("sha256").update(html, "utf8").digest("hex");
  return { renderMode: "sandbox_srcdoc", contractVersion: HTML_CONTRACT_VERSION, html, hasScript: true, checksum };
}

// ————————————————————————————————————————————————————————————
//  安全 / 反 slop 校验（LLM 增强路径的产物必须过此门，否则回落确定性渲染器）
// ————————————————————————————————————————————————————————————

export interface CoursewareLint {
  ok: boolean;
  issues: string[];
}

/** 机检一段课件 HTML 的安全与反 slop 底线（见计划 §4机制三 / §7）。确定性渲染器的产物应恒过此门。 */
export function validateCoursewareHtml(html: string): CoursewareLint {
  const issues: string[] = [];
  const h = html || "";

  // —— 安全硬门 ——
  if (!/Content-Security-Policy/i.test(h)) issues.push("缺少 CSP meta");
  if (!/connect-src\s+'none'/i.test(h)) issues.push("CSP 未掐断网络(connect-src 'none')");
  // 外链资源（http/https 或协议相对 //host）——课件必须自包含、无外链
  if (/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(h)) issues.push("含外链资源(src/href 外链)");
  if (/url\(\s*["']?(?:https?:)?\/\//i.test(h)) issues.push("CSS 含外链 url()");
  if (/\.(?:src|href)\s*=\s*["'][^"']*\/\//i.test(h)) issues.push("JS 赋值外链(.src/.href //)");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/.test(h)) issues.push("含网络调用(fetch/XHR/WS)");
  if (!/prefers-reduced-motion/i.test(h)) issues.push("缺少 reduce-motion 分支");

  // —— 反 slop / 性能 ——
  if (/font-family[^;}]*\b(Inter|Roboto|Arial|Open Sans|Helvetica)\b/i.test(h)) issues.push("使用了廉价默认字体");
  if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[1-9]/i.test(h)) issues.push("硬黑投影(rgba(0,0,0,.1+))");
  if (/background[^;}]*#(?:000000|000|ffffff|fff)\b/i.test(h)) issues.push("纯黑/纯白背景");
  if (/addEventListener\(\s*["']scroll["']/.test(h)) issues.push("用了 scroll 监听(性能杀手)");
  if (/@keyframes[^}]*\b(?:top|left|width|height)\s*:/i.test(h)) issues.push("动画了 layout 属性(非 GPU 安全)");
  if (/John Doe|Lorem Ipsum|Acme\b/i.test(h)) issues.push("含占位垃圾");
  if (/颠覆认知|全网最强|小白秒变|Unleash|Seamless|Next-Gen/i.test(h)) issues.push("含 AI 陈词/夸张营销");

  return { ok: issues.length === 0, issues };
}
