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
import type { CourseDesign, ArtDirection } from "./courseware-design";
import type { LessonVariance } from "./courseware-variance";
import { heroMotif, cornerMotif } from "./courseware-motifs";
import { illustrationSvg } from "./courseware-illustrations";
import { diagramHtml, DIAGRAM_CSS } from "./courseware-diagrams";
import { highlightLinesSync } from "./courseware-highlight";
import { hetiSpacing, HETI_SPACING_CSS } from "../cjk-spacing";
import { renderFormula, katexSelfContainedCss } from "./courseware-math";
import { interactiveHtml, INTERACTIVE_CSS, INTERACTIVE_RUNTIME } from "./courseware-interactive";
import { hashSeed } from "./courseware-design";
import { getModeProfile, type CoursewareMode } from "./courseware-catalog";

// 款式层字体族（modeCss 按 mode 换字族，与 art 的配色正交）。自包含、无外链（CSP 只允 data: 字体）。
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const SERIF_STACK = "'Songti SC','Source Han Serif SC','Noto Serif SC',Georgia,'Times New Roman',serif";

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

// —— 轻量确定性语法着色（代码课件 IDE 质感）——
// 跨语言通用 tokenizer：逐行扫描，先切 token 再对**每个 token 文本 esc()**、再包类名 span。
// 安全铁律：所有输出文本恒经 esc（先 tokenize 后 escape），class 由本文件控制，无 XSS 面。块注释/跨行串按行处理（学习片段足够）。
const CODE_KEYWORDS = new Set([
  "def","class","function","func","fn","return","import","from","export","default","package","use",
  "const","let","var","new","await","async","yield","lambda","this","self","super",
  "if","else","elif","for","while","do","in","of","switch","case","break","continue","pass",
  "try","except","catch","finally","with","as","throw","raise","match",
  "true","false","null","none","nil","void","int","str","float","bool","string","number","boolean",
  "public","private","protected","static","interface","type","struct","enum","typedef","namespace",
  "print","echo","and","or","not","is","typeof","instanceof","require","module",
]);

/** 单行代码 → 着色后的安全 HTML（每 token 先 esc 再包 span）。 */
export function highlightCodeLine(raw: string): string {
  const s = raw;
  let i = 0;
  let out = "";
  const put = (cls: string | null, text: string) => {
    out += cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text);
  };
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    // 行注释：// 通用；# 与 -- 须后随空白/行尾才算（避开自减 i--、CSS 变量 --x、hex 色值 #fff）。
    if ((m = /^(?:\/\/.*|#(?=\s|$).*|--(?=\s|$).*)/.exec(rest))) { put("tok-com", m[0]); i += m[0].length; continue; }
    if ((m = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(rest))) { put("tok-str", m[0]); i += m[0].length; continue; } // 字符串
    if ((m = /^\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?/.exec(rest))) { put("tok-num", m[0]); i += m[0].length; continue; } // 数字
    if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) { // 标识符 / 关键字 / 函数名
      const w = m[0];
      const isFn = /^\s*\(/.test(s.slice(i + w.length));
      put(CODE_KEYWORDS.has(w.toLowerCase()) ? "tok-kw" : isFn ? "tok-fn" : null, w);
      i += w.length;
      continue;
    }
    put(null, s[i]); // 运算符/标点/空白：原样（经 esc）
    i++;
  }
  return out;
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
  --ct-mono:${a.fontMono};
  --ct-shadow:${cardShadow};
}
html{color-scheme:${dark ? "dark" : "light"};-webkit-text-size-adjust:100%}
body{background:var(--ct-bg);color:var(--ct-ink);
  font-family:${a.fontBody};line-height:1.68;font-size:16px;
  padding:clamp(20px,5vw,56px) clamp(16px,5vw,40px) 120px;
  /* heti/现代排版：全角标点挤压 + CJK 严格换行。CJK-拉丁间距由服务端 .hs 标注负责,
     故显式关掉原生 text-autospace(审计 P3:Safari 18.4+ 原生 1/8em 会与 .hs 叠加成双倍留白)。 */
  text-spacing-trim:normal;text-autospace:no-autospace;line-break:strict;overflow-wrap:break-word;}
${HETI_SPACING_CSS}
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
body.ct-paged .page--band,body.ct-paged .page--surface,body.ct-paged .page--figure,body.ct-paged .page--spotlight{padding:clamp(14px,2.6vh,24px)}
/* hero/plain 不加框：hero 承载全出血签名母题背景，plain 交给内容自身结构，形成留白节奏。 */
.sec-fig{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.sec-fig svg{width:100%;height:100%;display:block}
.sec-corner{position:absolute;top:14px;right:14px;width:40px;height:40px;z-index:0;pointer-events:none;opacity:.85}
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
/* —— 场景开场（蓝图 B1：5 构图库，破骨架冻结）—— */
.opener{padding:clamp(28px,6vw,56px) 0}
.opener--band{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);
  box-shadow:var(--ct-shadow);padding:clamp(28px,5vw,48px)}
.opener--left{border-left:4px solid var(--ct-accent);padding-left:clamp(20px,4vw,32px)}
.opener--center{display:flex;flex-direction:column;align-items:center;text-align:center}
.opener--center .lead{max-width:18ch}
.opener--center .body{margin-left:auto;margin-right:auto}
.opener--split{display:grid;gap:clamp(18px,4vw,40px);align-items:end}
@media(min-width:620px){.opener--split{grid-template-columns:minmax(0,7fr) minmax(0,6fr)}
  .opener--split .lead{font-size:clamp(30px,5.6vw,52px)}}
.opener--poster{min-height:52vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.opener--poster .lead{font-size:clamp(32px,6.6vw,58px);max-width:16ch}
.opener--poster .body{margin-left:auto;margin-right:auto}
body.ct-paged .opener--poster{min-height:0}
/* 蓝图 B1（审查 P2-4）：标题按可平衡断行排（「…却/卡住了」类 CJK 断裂），不支持的浏览器无害回退。 */
.lead,.h-title,h1,h2,h3{text-wrap:balance}
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
.quiz .opt{display:flex;align-items:center;gap:11px;text-align:left;width:100%;cursor:pointer;
  background:var(--ct-surface2);border:1px solid var(--ct-border);border-radius:calc(var(--ct-radius) - 4px);
  padding:11px 15px 11px 11px;font:inherit;font-size:15px;color:var(--ct-ink);transition:border-color .25s var(--ct-ease),transform .2s var(--ct-ease)}
/* v4.2:选项字母釦(A/B/C/D)——把选择题从「一排灰条」升到「设计过的答题卡」;判定后随 ok/no 换色。 */
.quiz .opt .ol{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:calc(var(--ct-radius) - 8px);
  font-family:${a.fontMono};font-size:11.5px;font-weight:700;color:var(--ct-ink3);
  background:var(--ct-surface);border:1px solid var(--ct-border)}
.quiz .opt>span:not(.ol):not(.mk){flex:1}
.quiz .opt .mk{margin-left:auto}
.quiz .opt.ok .ol{background:#1f9e6e;border-color:#1f9e6e;color:#fff}
.quiz .opt.no .ol{background:#c9403f;border-color:#c9403f;color:#fff}
.quiz .opt:hover{border-color:var(--ct-accent)}
.quiz .opt:hover .ol{border-color:var(--ct-accent);color:var(--ct-accent-ink)}
.quiz .opt:active{transform:scale(.99)}
.quiz .opt .mk{font-family:${a.fontMono};font-size:12px;color:var(--ct-ink3);opacity:0}
.quiz .opt.ok{border-color:#1f9e6e;background:${dark ? "#0f2620" : "#e7f6ef"};animation:ct-pop .34s var(--ct-ease)}
.quiz .opt.ok .mk{opacity:1;color:#1f9e6e}
/* 错误态用跨 art 固定警示红(green-accent 的 art 里 accent 错误态会与正确绿混淆);底为 12% 红,亮暗底皆可读。 */
.quiz .opt.no{border-color:#c9403f;background:rgba(201,64,63,.12);animation:ct-shake .4s var(--ct-ease)}
.quiz .opt.no .mk{opacity:1;color:#c9403f}
/* 答题微反馈（v4 动效升级）：选对轻弹、选错横向抖动，只动 transform，reduce-motion 全禁。 */
@keyframes ct-pop{0%{transform:scale(1)}40%{transform:scale(1.035)}100%{transform:scale(1)}}
@keyframes ct-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
.quiz.answered .opt:not(.ok):not(.no){opacity:.5;transition:opacity .3s var(--ct-ease)}
.quiz .exp{margin-top:12px;font-size:14.5px;color:var(--ct-ink2);background:var(--ct-surface2);
  border-radius:calc(var(--ct-radius) - 4px);padding:12px 14px;max-height:0;overflow:hidden;opacity:0;
  transition:max-height .4s var(--ct-ease),opacity .35s var(--ct-ease),padding .4s var(--ct-ease);padding-top:0;padding-bottom:0}
.quiz.answered .exp{max-height:400px;opacity:1;padding-top:12px;padding-bottom:12px}
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
/* 蓝图 B4：内容级插图框景 */
.illu{margin:0;border:1px solid var(--ct-border);border-radius:var(--ct-radius);overflow:hidden;box-shadow:var(--ct-shadow)}
.illu figcaption{padding:10px 16px;border-top:1px solid var(--ct-border);background:var(--ct-surface2);
  font-size:13.5px;color:var(--ct-ink2);text-align:center}
${DIAGRAM_CSS}
${INTERACTIVE_CSS}
/* —— 补齐版式：variance 已抽签的 example/steps/compare/quiz/summary 新版式（破同型块单调）—— */
.ex--quote{background:var(--ct-surface);border:1px solid var(--ct-border);border-radius:var(--ct-radius);box-shadow:var(--ct-shadow);padding:clamp(24px,4vw,36px) clamp(22px,4vw,32px);position:relative}
.ex--quote::before{content:"\\201C";position:absolute;top:2px;left:14px;font-family:${a.fontDisplay};font-size:72px;line-height:1;color:var(--ct-accent);opacity:.22}
.ex--quote .body{font-family:${a.fontDisplay};font-weight:${a.displayWeight};letter-spacing:${a.displayTracking};font-size:clamp(18px,3vw,23px);line-height:1.5;color:var(--ct-ink);padding-left:26px}
.ex--ticket{background:var(--ct-surface2);border:1px dashed var(--ct-border);border-radius:var(--ct-radius);position:relative;overflow:hidden}
.ex--ticket .tk-h{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px dashed var(--ct-border);font-family:${a.fontMono};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ct-ink3)}
.ex--ticket .tk-b{padding:16px 18px}
.steps--rail{display:flex;flex-wrap:wrap;gap:0;list-style:none;padding:0}
.steps--rail li{flex:1 1 120px;min-width:112px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:0 16px 12px 0;position:relative;grid-template-columns:none}
.steps--rail li::after{content:"";position:absolute;left:15px;right:0;top:14px;height:2px;background:var(--ct-border);z-index:0}
.steps--rail li:last-child::after{display:none}
.steps--rail li::before{display:none}
.steps--rail .n{position:relative;z-index:1}
.steps--rail .st{font-size:14px}
.steps--rail .sd{font-size:12.5px;margin-top:2px}
.cmp--ledger{display:block;border:1px solid var(--ct-border);border-radius:var(--ct-radius);overflow:hidden}
.cmp--ledger .lg-row{display:grid;grid-template-columns:1fr 1fr}
.cmp--ledger .lg-row+.lg-row{border-top:1px solid var(--ct-border)}
.cmp--ledger .lg-cell{padding:12px 16px;font-size:14.5px;color:var(--ct-ink2)}
.cmp--ledger .lg-cell+.lg-cell{border-left:1px solid var(--ct-border)}
.cmp--ledger .lg-cell.r{background:var(--ct-accent-soft);color:var(--ct-ink)}
.cmp--ledger .lg-head .lg-cell{font-family:${a.fontMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ct-ink3);background:var(--ct-surface2)}
.cmp--ledger .lg-head .lg-cell.r{color:var(--ct-accent-ink)}
.quiz--split .q-grid{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:560px){.quiz--split .q-grid{grid-template-columns:5fr 6fr;align-items:start}}
.quiz--split .q{margin-bottom:0}
.summary--band{background:var(--ct-accent-soft);border:1px solid var(--ct-accent);box-shadow:none}
.summary--band .next{background:transparent;border-top-color:var(--ct-accent);color:var(--ct-accent-ink)}
/* —— code：终端/编辑器镜框 + 行号栏（吸收 reveal/slidev 代码课件；developer-training 门面）—— */
.code-term{background:var(--ct-surface2);border:1px solid var(--ct-border);border-radius:var(--ct-radius);overflow:hidden}
.code-term .ct-bar{display:flex;align-items:center;gap:7px;padding:9px 14px;border-bottom:1px solid var(--ct-border);background:var(--ct-surface)}
.code-term .ct-dot{width:10px;height:10px;border-radius:50%;flex:none}
.code-term .ct-dot.r{background:#ff5f57}.code-term .ct-dot.y{background:#febc2e}.code-term .ct-dot.g{background:#28c840}
.code-term .ct-fname{margin-left:8px;font-family:${a.fontMono};font-size:12px;color:var(--ct-ink3);letter-spacing:.04em}
.code-term .ct-code{counter-reset:ln;margin:0;padding:12px 0;overflow:auto;font-family:${a.fontMono};font-size:13.5px;line-height:1.65;color:var(--ct-ink)}
.code-term .cl{display:block;padding:0 16px 0 52px;position:relative;white-space:pre}
.code-term .cl::before{counter-increment:ln;content:counter(ln);position:absolute;left:0;width:38px;text-align:right;color:var(--ct-ink3);opacity:.55}
.code-term .ct-note{padding:12px 16px;border-top:1px solid var(--ct-border);font-size:14.5px;color:var(--ct-ink2)}
/* 语法着色（substrate 调优：暗场用亮色、亮场用深色，均高对比，是代码课件的专属语义色板） */
.code-term .tok-kw{color:${dark ? "#c792ea" : "#8250df"};font-weight:600}
.code-term .tok-str{color:${dark ? "#7ee787" : "#0a7d33"}}
.code-term .tok-com{color:var(--ct-ink3);font-style:italic;opacity:.85}
.code-term .tok-num{color:${dark ? "#f0a35e" : "#953800"}}
.code-term .tok-fn{color:${dark ? "#79c0ff" : "#0550ae"}}
/* —— spotlight 页型（暗场专属戏剧页：径向聚光 + 顶部霓虹细线）—— */
.page--spotlight{border-radius:var(--ct-radius);overflow:hidden;padding:clamp(20px,4vw,34px);background:radial-gradient(120% 92% at 50% 3%, var(--ct-accent-soft) 0%, transparent 58%), var(--ct-surface)}
.page--spotlight::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,var(--ct-accent),transparent);opacity:.85}
/* —— keypoint kpi（大数字玻璃要点墙，吸收 html-ppt-skill 的 kpi-grid）—— */
.kp--kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kp--kpi .item{flex-direction:column;align-items:flex-start;gap:8px;padding:16px}
.kp--kpi .item .b{width:auto;height:auto;background:none;padding:0;font-family:${a.fontMono};font-size:26px;font-weight:700;color:var(--ct-accent-ink)}
/* —— 页内分步揭示（fragment）：data-steps 页的 stagger 子项逐个 frag-in（其余页仍整页入场）—— */
[data-stagger]>*.frag-in{opacity:1;transform:none}
/* 蓝图 B2（审查 P2-2）：分步页舞台预排——未揭示条目以幽灵占位显形（低透明、原位），
   首步即可见整页结构，不再是「一条内容悬在 80% 空白上」；揭示时从幽灵淡入实体。 */
body.ct-paged .deck>section[data-steps] [data-stagger]:not(.in)>*{opacity:.13;transform:none}
body.ct-paged .deck>section[data-steps] [data-stagger]:not(.in)>*.frag-in{opacity:1}
/* 蓝图 B3（审查 P2-3）：短内容页密度自适应——收窄版心 + 提字号，让少量内容占住舞台而非悬空。 */
.pg-brief .ct-fit{max-width:640px;margin-left:auto;margin-right:auto}
.pg-brief .body{font-size:clamp(17.5px,2.4vw,21px);line-height:1.8}
.pg-brief .h-title{font-size:clamp(22px,3.8vw,30px)}
/* —— 入场动效（GPU 安全：只动 transform/opacity）——
   永不空白底线(2026-07-20)：一切「藏内容等 JS 揭示」的初始态全部挂在 .ct-js 下——
   该类由运行时脚本**首行**加到 <html> 上。脚本因任何原因(CSP/引擎差异/未来回归)没跑时,
   没有 ct-js → 内容以完整可读文档呈现。宁可没动画,绝不白屏。 */
.ct-js [data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .7s var(--ct-ease),transform .7s var(--ct-ease)}
.ct-js [data-reveal].m-fade{transform:none}
.ct-js [data-reveal].m-scale{transform:scale(.96)}
[data-reveal].in{opacity:1;transform:none}
.ct-js [data-stagger]>*{opacity:0;transform:translateY(14px);transition:opacity .55s var(--ct-ease),transform .55s var(--ct-ease)}
[data-stagger].in>*{opacity:1;transform:none}
[data-stagger].in>*{transition-delay:calc(var(--i,0) * 80ms)}
@media (prefers-reduced-motion: reduce){
  [data-reveal],[data-stagger]>*{opacity:1!important;transform:none!important;transition:none!important}
  .fc .inner{transition:none}
  /* v4 动效升级的答题反馈同样受 reduce-motion 约束（无障碍铁律）。 */
  .quiz .opt.ok,.quiz .opt.no{animation:none!important}
  .quiz .exp{transition:none!important}
}
@media (max-width:640px){
  .cmp,.kp{grid-template-columns:1fr}
  .turn{max-width:92%}
}
/* —— 翻页模式（默认；body.ct-paged 由运行时切换，父页可发 ct-mode 覆盖）——
   每个 .deck>section 即一页：单屏居中呈现，超高内容由 .ct-fit 等比缩放到一屏（不滚）。 */
body.ct-paged{height:100vh;overflow:hidden;padding:0}
/* deck 转 grid:同刻只有 .ct-cur 一页可见,grid 让「收身页」在视口垂直居中(块布局做不到)。 */
body.ct-paged .deck{height:100%;max-width:880px;display:grid;align-items:center;justify-items:stretch;padding:clamp(16px,3.5vh,32px) clamp(18px,4.5vw,44px) 78px}
body.ct-paged .deck>section{display:none;height:100%}
body.ct-paged .deck>section.ct-cur{display:grid;place-items:center;overflow:hidden}
/* v4.2 舞台收身(生产课件精进·实评「框满屏、内容浮中段、上下大片死空间」):
   带框页(band/surface/figure/spotlight)不再撑满全屏——框随内容收身、整框居中,
   留白回到框外(页底色)而非框内;min-height 兜底,极短内容不至于缩成贴纸。
   hero/plain 保持撑满(hero 承载全出血母题背景,plain 的留白本就是构图)。 */
body.ct-paged .deck>section.ct-cur.page--band,
body.ct-paged .deck>section.ct-cur.page--surface,
body.ct-paged .deck>section.ct-cur.page--figure,
body.ct-paged .deck>section.ct-cur.page--spotlight{height:auto;max-height:100%;min-height:min(46vh,420px)}
/* 缩到下限仍超高的页：改为本页内部纵向滚动 + 顶对齐，绝不裁切内容（长 steps/quiz/代码块保底可读）。 */
body.ct-paged .deck>section.ct-cur.ct-scroll{place-items:start center;overflow-y:auto;overflow-x:hidden;height:100%}
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
  // 永不空白底线：首行声明「JS 已在跑」——所有隐藏初始态(.ct-js [data-reveal] 等)据此挂载;
  // 本脚本被拦/没跑时无此类,内容以完整可读文档呈现(见 baseCss 入场动效段)。
  document.documentElement.classList.add('ct-js');
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
    els.forEach(function(e){
      // 分步页(data-steps)内的 stagger 容器**绝不交给 IO**：否则翻到该页时 IO 会给容器加 .in、
      // CSS 令所有子项一次性全显，击穿逐条揭示。这些容器的子项只受 show()/nav() 的 .frag-in 驱动。
      if (e.matches && e.matches('[data-stagger]') && e.closest && e.closest('[data-steps]')) return;
      io.observe(e);
    });
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
          // 蓝图 D2：作答结果回传宿主（进错题本/复习卡/学习数据）。沙箱内无网络，只能走 postMessage。
          try{ parent.postMessage({type:'ct-quiz', bid:q.getAttribute('data-bid')||null, answer:i, correct:i===ans}, '*'); }catch(e){}
        });
      });
    });
  }
  function cards(){
    document.querySelectorAll('.fc').forEach(function(c){
      c.addEventListener('click',function(){
        c.classList.toggle('flip');
        // 蓝图 D2：首次翻面回传（复习行为信号）；之后的来回翻不重复上报。
        if(!c.__ctFlipped){ c.__ctFlipped = true; try{ parent.postMessage({type:'ct-flash', bid:c.getAttribute('data-bid')||null}, '*'); }catch(e){} }
      });
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
  // 页内分步揭示（fragment）状态：fragEls=当前页可逐条揭示的子项，fragIdx=已揭示到第几条。
  var fragEls = null, fragIdx = 0;
  function revealNow(sec){ // 整页揭示（非分步页 / 回看 / reduce）：所有 reveal+stagger+frag 全显。
    var cw = sec.querySelectorAll('[data-reveal],[data-stagger]');
    for (var q = 0; q < cw.length; q++) cw[q].classList.add('in');
    var fr = sec.querySelectorAll('[data-stagger]>*');
    for (var k = 0; k < fr.length; k++) fr[k].classList.add('frag-in');
  }
  function updateNav(){
    if (prevBtn) prevBtn.disabled = cur === 0;
    // 末页且本页 frag 已揭完才禁用「下一页」；否则「下一页」还要用于逐条揭示。
    if (nextBtn) nextBtn.disabled = (cur === secs.length - 1) && !(fragEls && fragIdx < fragEls.length);
  }
  function show(i, revealAll){
    if (!secs.length) return;
    cur = Math.max(0, Math.min(secs.length - 1, i));
    secs.forEach(function(s, j){ s.classList[j === cur ? 'add' : 'remove']('ct-cur'); });
    // 翻页模式下不能只靠 IntersectionObserver（页在 display:none↔显示间切换时不可靠），显式揭示当前页。
    fragEls = null; fragIdx = 0;
    var sec = secs[cur];
    if (!reduce) {
      var stepped = sec.hasAttribute('data-steps') && !revealAll;
      var frags = stepped ? sec.querySelectorAll('[data-stagger]>*') : null;
      if (stepped && frags && frags.length > 1) {
        // 分步页：先揭示标题/容器与第一条，其余等「下一步」逐条（→先看一条再看下一条）。
        sec.querySelectorAll('[data-reveal]').forEach(function(e){ e.classList.add('in'); });
        // 关键：清掉本页 stagger 容器可能残留的 .in（滚动模式/回看留下的），
        // 否则 CSS [data-stagger].in>* 会令子项一次性全显、击穿逐条揭示。子项此后只受 .frag-in 控制。
        sec.querySelectorAll('[data-stagger]').forEach(function(e){ e.classList.remove('in'); });
        for (var f = 0; f < frags.length; f++) frags[f].classList.remove('frag-in');
        frags[0].classList.add('frag-in');
        fragEls = frags; fragIdx = 1;
      } else {
        revealNow(sec); // 非分步 / 回看 / ≤1 条：整页揭示
      }
    } else {
      revealNow(sec); // reduce：全显不分步（不强迫多次点击，无障碍）
    }
    updateNav();
    if (count) count.textContent = (cur + 1) + ' / ' + secs.length;
    progress.style.width = (((cur + 1) / secs.length) * 100) + '%';
    fit();
    try{ parent.postMessage({type:'ct-page', index: cur, total: secs.length, frags: fragEls ? fragEls.length : 0}, '*'); }catch(e){}
  }
  function nav(d){
    if (mode !== 'paged') return;
    // 前进时：本页还有未揭示的 frag → 先揭下一条（不翻页）；否则翻页。回看(←)直接整页全显。
    if (d === 1 && fragEls && fragIdx < fragEls.length) { fragEls[fragIdx].classList.add('frag-in'); fragIdx++; updateNav(); fit(); return; }
    show(cur + d, d < 0);
  }
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
  // 蓝图 B6（审查 P1-3）：触摸/笔滑动翻页——此前移动端只能点页脚按钮。
  // 水平位移 >56px 且明显大于纵向才翻，避开点按与本页内滚动；交互控件上的滑动不劫持。
  var swx = null, swy = null;
  // 审计修复：只认触摸/笔——鼠标横向拖选文字不应触发翻页（选区会被销毁）。
  window.addEventListener('pointerdown', function(e){ if (e.isPrimary === false || e.pointerType === 'mouse') return; swx = e.clientX; swy = e.clientY; });
  // 触摸被系统接管(滚动/手势)会发 pointercancel 而非 pointerup——不清起点的话,
  // 混合输入设备上下一次 pointerup 会用陈旧起点误翻页。
  window.addEventListener('pointercancel', function(){ swx = swy = null; });
  window.addEventListener('pointerup', function(e){
    if (swx == null || mode !== 'paged') { swx = swy = null; return; }
    var dx = e.clientX - swx, dy = e.clientY - swy; swx = swy = null;
    var tag = ((e.target && e.target.tagName) || '').toUpperCase();
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) nav(dx < 0 ? 1 : -1);
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
    // v4.2 续读:宿主在握手后下发上次读到的页(0-indexed);越界钳制,revealAll 立即整页显示不走逐条。
    else if (d.type === 'ct-goto' && typeof d.page === 'number') { if (mode === 'paged') show(d.page, true); }
    else if (d.type === 'ct-hello') announce();
  });

  reveal(); quiz(); cards();
${INTERACTIVE_RUNTIME}
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
      // 蓝图 B1：5 种开场构图（band 卡面 / left 竖线 / center 居中 / split 分屏 / poster 海报），
      // 由 variance 抽签，破「每节第一页同一副骨架」。
      if (variant === "hero-split") {
        return `<section ${rv}><div class="opener opener--split">
          <div><span class="eyebrow">场景 · 为什么学</span>${b.title ? `<h1 class="lead">${esc(b.title)}</h1>` : ""}</div>
          ${b.markdown ? `<div class="body">${md(b.markdown)}</div>` : ""}</div></section>`;
      }
      const cls =
        variant === "hero-band" ? "opener opener--band"
        : variant === "hero-left" ? "opener opener--left"
        : variant === "hero-center" ? "opener opener--center"
        : variant === "hero-poster" ? "opener opener--poster"
        : "opener";
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
      if (variant === "quote-card")
        return `<section ${rv}><div class="ex--quote"><div class="body">${md(b.markdown)}</div></div></section>`;
      if (variant === "ticket")
        return `<section ${rv}><div class="ex--ticket"><div class="tk-h"><span>例 · 示范</span><span>Example</span></div>
          <div class="tk-b"><div class="body" style="color:var(--ct-ink)">${md(b.markdown)}</div></div></div></section>`;
      return `<section ${rv}><div class="ex">${inner}</div></section>`;
    }
    case "steps": {
      const cards = variant === "numbered-cards";
      const rail = variant === "rail";
      return `<section ${rv}><span class="eyebrow">操作步骤</span>
        <ol class="steps ${rail ? "steps--rail" : cards ? "steps--cards" : ""}" data-stagger>${b.steps
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
      const eyebrow = b.title ? `<span class="eyebrow">${esc(b.title)}</span>` : `<span class="eyebrow">对比辨析</span>`;
      // ledger：左右对齐成台账行（表格式），与双面板 duel/stacked 构图不同。
      if (variant === "ledger") {
        const rows = Math.max(b.left.items.length, b.right.items.length);
        const body = Array.from({ length: rows }, (_, k) =>
          `<div class="lg-row"><div class="lg-cell">${esc(b.left.items[k] || "")}</div><div class="lg-cell r">${esc(b.right.items[k] || "")}</div></div>`,
        ).join("");
        return `<section ${rv}>${eyebrow}<div class="cmp--ledger">
          <div class="lg-row lg-head"><div class="lg-cell">${esc(b.left.heading || "常见误区")}</div><div class="lg-cell r">${esc(b.right.heading || "正确做法")}</div></div>
          ${body}</div></section>`;
      }
      const col = (heading: string, items: string[], right: boolean) =>
        `<div class="col ${right ? "right" : "wrong"}"><h4>${esc(heading)}</h4><ul>${items
          .map((it) => `<li>${esc(it)}</li>`)
          .join("")}</ul></div>`;
      return `<section ${rv}>${eyebrow}
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
        <div class="kp ${variant === "checklist" ? "kp--list" : variant === "kpi" ? "kp--kpi" : ""}" data-stagger>${b.points
          .map((p, k) => `<div class="item" style="--i:${k}"><span class="b">${k + 1}</span><span>${esc(p)}</span></div>`)
          .join("")}</div></section>`;
    case "callout":
      return `<section ${rv}><div class="callout ${b.tone === "warn" ? "warn" : "info"}"><span class="ic">${
        b.tone === "warn" ? "!" : "i"
      }</span><div class="body" style="color:var(--ct-ink)">${md(b.markdown)}</div></div></section>`;
    case "code": {
      // 终端/编辑器镜框 + 行号（交通灯点 + 文件名 tab + 逐行行号栏），远比裸 <pre> 专业。
      // v4.4：优先用 shiki（VS Code 同源着色，服务端渲染期已 ensure）；未就绪回落手写高亮。
      const code = String(b.code || "");
      const shiki = highlightLinesSync(code, b.lang, design.art.substrate === "dark");
      const lines = shiki ?? code.split("\n").map((l) => highlightCodeLine(l));
      const codeBody = lines.map((l) => `<span class="cl">${l || "&nbsp;"}</span>`).join("");
      return `<section ${rv}><div class="code-term">
        <div class="ct-bar"><span class="ct-dot r"></span><span class="ct-dot y"></span><span class="ct-dot g"></span><span class="ct-fname">${esc(b.lang || "code")}</span></div>
        <pre class="ct-code"><code>${codeBody}</code></pre>${
          b.explanation ? `<div class="ct-note">${esc(b.explanation)}</div>` : ""
        }</div></section>`;
    }
    case "quiz": {
      const opts = `<div class="opts">${b.options
        .map((o, oi) => `<button class="opt"><span class="ol">${String.fromCharCode(65 + oi)}</span><span>${esc(o)}</span><span class="mk">●</span></button>`)
        .join("")}</div>`;
      // split：题干与选项左右分栏（宽屏），与单列 stage 构图不同；交互 JS 靠 .quiz/.opt 不变。
      // data-bid：块 id，作答结果经 ct-quiz 回传宿主时定位到具体块（蓝图 D2）。
      if (variant === "split") {
        return `<section ${rv}><div class="card quiz quiz--split" data-answer="${b.answerIndex}" data-bid="${esc(b.id)}"><span class="pill">随堂测</span>
          <div class="q-grid" style="margin-top:12px"><div class="q">${esc(b.question)}</div>${opts}</div>
          <div class="exp">${esc(b.explain)}</div></div></section>`;
      }
      return `<section ${rv}><div class="card quiz" data-answer="${b.answerIndex}" data-bid="${esc(b.id)}"><span class="pill">随堂测</span>
        <div class="q" style="margin-top:12px">${esc(b.question)}</div>
        ${opts}
        <div class="exp">${esc(b.explain)}</div></div></section>`;
    }
    case "flashcard":
      return `<section ${rv}><div class="fc" data-bid="${esc(b.id)}"><div class="inner">
        <div class="face front"><span class="lab">记忆卡 · 点击翻面</span><div class="t">${esc(b.front)}</div></div>
        <div class="face back"><span class="lab">答案</span><div class="t">${esc(b.back)}</div></div>
      </div></div></section>`;
    case "summary": {
      const band = variant === "band";
      return `<section ${rv}><div class="summary ${band ? "summary--band" : ""}"><div class="top"><span class="pill">本节小结</span>
        <div class="body" style="margin-top:12px;color:var(--ct-ink)">${md(b.markdown)}</div></div>
        ${b.next ? `<div class="next"><b>下一节</b>${esc(b.next)}</div>` : ""}</div></section>`;
    }
    case "image": {
      // 蓝图 B4（审查 P1-10）：image 块不再是文字占位——按 caption 语义 + 种子生成主题化内联插图
      // （概念图/流程/比例环/柱图/几何场景，全取 art token 上色），CSP 自包含铁律不变。
      const label = b.caption || b.alt || "";
      const svg = illustrationSvg(design.art, hashSeed(`illu:${b.id}:${label}`), label);
      return `<section ${rv}><figure class="illu">${svg}${label ? `<figcaption>${esc(label)}</figcaption>` : ""}</figure></section>`;
    }
    case "diagram": {
      // v4.3 语义图示(leohtml 纪律):结构取自关系、节点标签来自内容、方向显式、结果强调。
      // 节点自带卡面,不再套外层 card(避免与 surface/figure 页型双重框)。
      return `<section ${rv}>${diagramHtml(b)}</section>`;
    }
    case "formula": {
      // v4.3 公式(KaTeX):服务端渲染自包含 HTML;display 独立居中,caption 作图注。
      const inner = renderFormula(b.latex, b.display !== false);
      return `<section ${rv}><figure class="ct-formula">${inner}${
        b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""
      }</figure></section>`;
    }
    case "fillblank":
    case "dragwords":
      // v4.3 交互块(H5P 式):填空/拖词,判分经 ct-quiz 回传宿主进错题闭环(见 courseware-interactive)。
      return `<section ${rv}>${interactiveHtml(b)}</section>`;
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
  /** 款式（内容类型→呈现风格）。缺省 scroll-lesson。决定宏观版式：排版/构图/镜框，与配色正交。 */
  mode?: CoursewareMode;
}

// —— 页型档案（Page Archetype）：给每个 block 的整页一个「舞台」，翻页时构图有对比 ——
// 打破「每页都是 小字→标题→段落→卡片 的同底色纵向堆叠」。scene/summary 为情绪书挡 → hero 母题背景；
// 其余按 (seed+index) 确定性在 band/surface/figure/plain 间轮转，且不与相邻页同型（保证翻页视觉分化）。
type Stage = "band" | "surface" | "figure" | "plain" | "spotlight" | "hero";
const STAGE_POOL: readonly Stage[] = ["band", "surface", "figure", "plain"];
// 暗场额外掺入 spotlight（径向聚光戏剧页），给深色方向更强的构图对比。
const STAGE_POOL_DARK: readonly Stage[] = ["band", "surface", "figure", "spotlight", "plain"];
// 这些 block 天然可「逐条揭示」，其页启用 fragment 分步（data-steps）。
const FRAG_TYPES = new Set(["steps", "keypoint", "objectives", "dialog", "diagram"]);

/** 公式框景 CSS（仅含 formula 块的课注入；配色吃 art token，KaTeX 文字色继承随主题）。 */
const FORMULA_FRAME_CSS =
  ".ct-formula{margin:0;padding:clamp(14px,3vw,22px);background:var(--ct-surface);border:1px solid var(--ct-border);" +
  "border-radius:var(--ct-radius);box-shadow:var(--ct-shadow);overflow-x:auto;text-align:center}" +
  ".ct-formula .katex{color:var(--ct-ink);font-size:1.15em}" +
  ".ct-formula figcaption{margin-top:10px;font-size:13px;color:var(--ct-ink3);text-align:center}" +
  ".ct-formula-fallback{font-family:var(--ct-mono,monospace);color:var(--ct-accent-ink);background:var(--ct-surface2);padding:2px 6px;border-radius:4px}";

function stageFor(type: string, i: number, seed: number, prev: Stage | null, pool: readonly Stage[]): Stage {
  if (type === "scene" || type === "summary") return "hero";
  let s: Stage = pool[(seed + i) % pool.length];
  if (s === prev) s = pool[(seed + i + 1) % pool.length];
  return s;
}

const ROTATING_STAGES = new Set<string>(["band", "surface", "figure", "plain", "spotlight"]);

/**
 * 款式的「页型节奏」：用 mode 档案的 archetypeEmphasis 定制非 hero 页的轮转池，
 * 让不同 mode 的整页构图节奏不同（PPT 偏 band/plain 大留白，编程偏 surface/figure 镜框，等）。
 * 不足两种可轮转时回退基础池，避免相邻页老同型。
 */
function stagePoolFor(mode: CoursewareMode, dark: boolean): readonly Stage[] {
  const base = dark ? STAGE_POOL_DARK : STAGE_POOL;
  const emph = getModeProfile(mode).archetypeEmphasis.filter((s): s is Stage => ROTATING_STAGES.has(s));
  const uniq = Array.from(new Set(emph));
  return uniq.length >= 2 ? uniq : base;
}

/**
 * 款式层（v3.6，根治「只有配色不同」）：按 mode 给整节课件一套**宏观版式**——排版字族 / 整页构图 /
 * 镜框 / 装饰 / 块内布局，与 art 的配色正交。作用域全挂在 body.ct-mode-{mode} 下，覆盖 baseCss 的对应
 * 块类（选择器更具体，天然胜出），**不改 DOM 结构与交互 JS**（.quiz/.fc/.opt/.dlg 等钩子不变），
 * 只重塑长相 → 不同内容类型出不同款式，而非只换色。运行时翻页/滚动两模式下均适用。
 */
function modeCss(mode: CoursewareMode): string {
  const m = `body.ct-mode-${mode}`;
  switch (mode) {
    case "developer-training":
      return `
${m}{--ct-radius:8px}
${m} .lead,${m} .h-title,${m} h1,${m} h2,${m} h3,${m} .tide-md-h{font-family:${MONO_STACK};letter-spacing:-.02em}
${m} .eyebrow,${m} .pill{border-radius:4px}
${m} .page--surface,${m} .page--figure{padding-top:44px;border-radius:10px}
${m} .page--surface::before,${m} .page--figure::before{content:"";position:absolute;top:15px;left:18px;width:10px;height:10px;border-radius:50%;background:var(--ct-accent);box-shadow:17px 0 0 var(--ct-ink3),34px 0 0 var(--ct-border);z-index:2}
${m} .page--surface::after,${m} .page--figure::after{content:"~/lesson — zsh";position:absolute;top:12px;left:70px;font-family:${MONO_STACK};font-size:11px;color:var(--ct-ink3);z-index:2}
${m} .body ul{list-style:none;padding-left:2px}
${m} .body ul li{padding-left:20px;position:relative}
${m} .body ul li::before{content:"›";position:absolute;left:0;color:var(--ct-accent);font-family:${MONO_STACK};font-weight:700}
${m} .steps .n{border-radius:5px}
${m} .kp .item{border-left:3px solid var(--ct-accent);border-radius:0 6px 6px 0}
${m} .tide-md-pre{border-radius:8px;position:relative;padding-top:32px}
${m} .tide-md-pre::before{content:"● ● ●";position:absolute;top:8px;left:12px;font-size:9px;letter-spacing:3px;color:var(--ct-ink3)}
`;
    case "editorial-academic":
      return `
${m} .lead,${m} .h-title,${m} .body,${m} h1,${m} h2,${m} h3,${m} li,${m} p{font-family:${SERIF_STACK}}
${m} .deck{max-width:720px}
${m} .body{font-size:17px;line-height:1.85;text-align:justify;text-justify:inter-character}
${m} .eyebrow{font-family:${MONO_STACK};border-bottom:1px solid var(--ct-border);padding-bottom:6px;letter-spacing:.14em}
${m} .h-title{border-bottom:2px solid var(--ct-ink);padding-bottom:8px;display:table}
${m} .page--surface,${m} .page--band,${m} .page--figure{background:transparent;border:0;box-shadow:none;border-left:2px solid var(--ct-border);border-radius:0;padding-left:clamp(18px,4vw,30px)}
${m} .card,${m} .ex{box-shadow:none;border-radius:2px}
${m} .cmp .col{border-radius:2px}
${m} .body p:first-of-type::first-letter{font-size:3.1em;float:left;line-height:.86;padding:2px 10px 0 0;font-weight:700;color:var(--ct-accent)}
`;
    case "deck-horizontal":
      return `
${m}{padding-top:clamp(16px,4vh,40px)}
${m} .deck{max-width:860px}
${m} .lead{font-size:clamp(38px,8vw,72px);line-height:1.02}
${m} .h-title{font-size:clamp(26px,5vw,40px)}
${m} .eyebrow{font-size:12px;letter-spacing:.32em}
${m} .page--hero{text-align:center}
${m} .page--hero .eyebrow{display:block}
${m} .page--band,${m} .page--surface,${m} .page--figure{border-radius:calc(var(--ct-radius) + 6px);padding:clamp(28px,5vw,46px)}
${m} .body{font-size:19px}
${m} .kp{grid-template-columns:1fr}
${m} .kp .item{font-size:18px;padding:16px 18px}
${m} .quiz .q{font-size:22px}
`;
    case "cinematic-tech":
      return `
${m} .lead{font-size:clamp(34px,6.4vw,58px);text-shadow:0 0 30px color-mix(in srgb,var(--ct-accent) 30%,transparent)}
${m} .page--surface,${m} .page--figure,${m} .card,${m} .fc .face,${m} .summary{background:color-mix(in srgb,var(--ct-surface) 82%,transparent);backdrop-filter:blur(6px);border:1px solid color-mix(in srgb,var(--ct-accent) 30%,var(--ct-border));box-shadow:0 0 0 1px color-mix(in srgb,var(--ct-accent) 14%,transparent),0 24px 60px -30px color-mix(in srgb,var(--ct-accent) 60%,transparent)}
${m} .h-title{position:relative;padding-bottom:10px}
${m} .h-title::after{content:"";position:absolute;left:0;bottom:0;width:56px;height:2px;background:linear-gradient(90deg,var(--ct-accent),transparent);box-shadow:0 0 10px var(--ct-accent)}
${m} .pill{box-shadow:0 0 16px -4px color-mix(in srgb,var(--ct-accent) 70%,transparent)}
${m} .quiz .opt{background:color-mix(in srgb,var(--ct-surface2) 70%,transparent)}
${m} .kp .item .b{box-shadow:0 0 12px -2px color-mix(in srgb,var(--ct-accent) 70%,transparent)}
`;
    case "interactive-quiz":
      return `
${m}{--ct-radius:18px}
${m} .quiz,${m} .fc{position:relative}
${m} .page--surface:has(.quiz),${m} .page:has(.quiz){padding-top:46px}
${m} .page:has(.quiz)::before{content:"检查点 · CHECKPOINT";position:absolute;top:14px;left:18px;font-family:${MONO_STACK};font-size:10px;letter-spacing:.18em;color:var(--ct-accent-ink);background:var(--ct-accent-soft);padding:4px 10px;border-radius:999px;z-index:2}
${m} .quiz .q{font-size:20px}
${m} .quiz .opt{padding:15px 18px;border-width:1.5px;border-radius:14px;font-size:16px}
${m} .quiz .opt:hover{transform:translateX(3px)}
${m} .fc .face{border-radius:20px;border-width:1.5px}
${m} .fc .face::after{content:"翻转 ↻";position:absolute;bottom:12px;right:16px;font-family:${MONO_STACK};font-size:11px;color:var(--ct-ink3)}
${m} .kp .item{border-radius:14px}
`;
    case "course-dashboard":
      return `
${m} .eyebrow{font-family:${MONO_STACK}}
${m} .page--surface,${m} .page--figure,${m} .card{border-radius:calc(var(--ct-radius) - 2px);border:1px solid var(--ct-border);box-shadow:var(--ct-shadow)}
${m} .page--figure{border-left:4px solid var(--ct-accent)}
${m} .kp{grid-template-columns:repeat(2,1fr);gap:12px}
${m} .kp .item{flex-direction:column;align-items:flex-start;gap:8px;background:var(--ct-surface);padding:16px}
${m} .kp .item .b{width:26px;height:26px}
${m} .obj li{background:var(--ct-surface2);border:1px solid var(--ct-border);border-radius:10px;padding:12px 14px}
${m} .steps li{grid-template-columns:auto 1fr}
${m} .h-title::before{content:"▮ ";color:var(--ct-accent)}
`;
    case "spatial-concept-map":
      return `
${m} .page{background-image:radial-gradient(color-mix(in srgb,var(--ct-border) 60%,transparent) 1px,transparent 1px);background-size:22px 22px}
${m} .kp{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:22px 26px;position:relative}
${m} .kp .item{border-radius:999px;text-align:center;justify-content:center;background:var(--ct-surface);border:1.5px solid var(--ct-accent);box-shadow:var(--ct-shadow);position:relative}
${m} .kp .item::before{content:"";position:absolute;left:-26px;top:50%;width:26px;height:1.5px;background:var(--ct-border)}
${m} .kp .item:first-child::before{display:none}
${m} .cmp{position:relative}
${m} .h-title::before{content:"◇ ";color:var(--ct-accent)}
${m} .concept,${m} .body{position:relative}
`;
    case "sidebar-lesson":
      return `
${m} .page--surface,${m} .page--band,${m} .page--figure{border-left:4px solid var(--ct-accent);border-radius:0 var(--ct-radius) var(--ct-radius) 0;padding-left:clamp(22px,4vw,34px)}
${m} .eyebrow{color:var(--ct-accent-ink);background:var(--ct-accent-soft);padding:4px 10px;border-radius:6px}
${m} .steps{counter-reset:st}
${m} .steps .st{font-size:17px}
${m} .obj{border-left:3px solid var(--ct-accent);padding-left:16px}
${m} .kp .item{border-radius:0 8px 8px 0;border-left:3px solid var(--ct-accent)}
${m} .h-title{padding-left:14px;border-left:4px solid var(--ct-accent)}
`;
    case "scroll-lesson":
    default:
      return `
${m} .h-title::after{content:"";display:block;width:38px;height:3px;background:var(--ct-accent);border-radius:2px;margin-top:10px}
${m} .body{font-size:17px;line-height:1.8}
`;
  }
}

/** 蓝图 B3：块的可见文字量估算——短内容页升级构图（收窄版心+提字号），修「内容悬空+下半页死空间」。 */
function blockTextLen(b: IdBlock): number {
  switch (b.type) {
    case "concept":
      return (b.title?.length ?? 0) + b.markdown.length;
    case "example":
    case "callout":
      return b.markdown.length;
    case "summary":
      return b.markdown.length + (b.next?.length ?? 0);
    default:
      return Number.MAX_SAFE_INTEGER; // 结构块（steps/quiz/dialog…）不参与 brief 判定
  }
}

/** 确定性渲染：给定输入必产同一自包含 HTML（含 CSP、内联样式脚本、reduce-motion、页型舞台+签名母题）。 */
export function renderCoursewareHtml(input: RenderInput): string {
  const { title, blocks, design, variance } = input;
  const mode: CoursewareMode = input.mode ?? "scroll-lesson";
  // 页型节奏随 mode（款式）定制，破「每课同一套 band/surface/figure 轮转」。
  const pool = stagePoolFor(mode, design.art.substrate === "dark");
  let prev: Stage | null = null;
  const body = blocks
    .map((b, i) => {
      const stage = stageFor(b.type, i, variance.seed >>> 0, prev, pool);
      prev = stage;
      // 全出血装饰层（不随内容缩放，见运行时 wrapping 保留逻辑）。
      // v4.5:此前大幅母题**只画在 hero(第一页)**,第 2 页起全课回到无装饰同质——皮肤个性荡然无存。
      // 现在 spotlight 页也铺大幅母题(换种子避免与 hero 重复),band 页加角标,figure 保持角标:
      // 每门课翻到任何一页都带着自己皮肤的视觉签名。
      const deco =
        stage === "hero"
          ? heroMotif(design.art, (variance.seed + i) >>> 0)
          : stage === "spotlight"
            ? heroMotif(design.art, (variance.seed * 31 + i * 7 + 13) >>> 0)
            : stage === "figure" || stage === "band"
              ? cornerMotif(design.art)
              : "";
      // 可分步页加 data-steps：翻页运行时会让其 stagger 子项逐条揭示（先看一条再看下一条）。
      const steps = FRAG_TYPES.has(b.type) ? " data-steps" : "";
      const brief = blockTextLen(b) < 150 ? " pg-brief" : "";
      return `<section class="page page--${stage}${brief}"${steps}>${deco}${renderBlock(b, i, design, variance)}</section>`;
    })
    .join("\n");
  // heti CJK⇄半角间距：对正文统一处理一遍（标签感知，跳过 script/style/pre/code；
  // 代码块与运行时脚本不受影响，母题 SVG 无 CJK-拉丁混排）。
  const spacedBody = hetiSpacing(body);
  // KaTeX CSS+字体按需注入：仅当本节含 formula 块（无公式课零成本，见 courseware-math）。
  const hasFormula = blocks.some((b) => b.type === "formula");
  const mathCss = hasFormula ? katexSelfContainedCss() + FORMULA_FRAME_CSS : "";
  return (
    `<!doctype html><html lang="zh-CN"><head>${CSP_META}` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>${baseCss(design)}${geneCss(design.art)}${modeCss(mode)}${mathCss}</style></head>` +
    // v4.5 视觉基因:body 挂 ct-l-*(版式)/ct-m-*(动效签名)类,geneCss 据此分支——皮肤不再只是换色。
    `<body class="ct-mode-${mode} ct-l-${design.art.layout} ct-m-${design.art.motion}"><main class="deck">${spacedBody}</main><script>${RUNTIME_SCRIPT}</script></body></html>`
  );
}

/**
 * v4.5 视觉基因 CSS(leohtml 精髓入渲染器)——按皮肤的 layout(版式基因)与 motion(动效签名)分支。
 * 此前所有皮肤共用同一套版式与同一个淡入动效,「皮肤」只是换色,12 套里 9 套米白底肉眼无差。
 * 版式基因改标题字阶/对齐/构图气质;动效签名给进场以性格。铁律不破:只动 transform/opacity/clip-path
 * (合成友好),全部挂 .ct-js 下(JS 没跑=完整可读文档),reduce-motion 由 baseCss 的 !important 兜底。
 */
function geneCss(a: ArtDirection): string {
  const layout: Record<ArtDirection["layout"], string> = {
    soft: "", // 默认基线,不加料
    editorial: `
/* 版式基因·editorial:超大衬线标题、左对齐、强调下划线——编辑部气质 */
.ct-l-editorial .lead{font-size:clamp(32px,6vw,56px);line-height:1.12;text-align:left}
.ct-l-editorial .opener--center{align-items:flex-start;text-align:left}
.ct-l-editorial .opener--center .body{margin-left:0;margin-right:0}
.ct-l-editorial .h-title{font-size:clamp(23px,3.8vw,30px);display:inline-block;border-bottom:2px solid var(--ct-accent);padding-bottom:5px}
.ct-l-editorial .kicker{letter-spacing:.22em}`,
    terminal: `
/* 版式基因·terminal:等宽标题、提示符、左线代码气质 */
.ct-l-terminal .lead{font-family:${a.fontMono};font-size:clamp(23px,4.4vw,38px);letter-spacing:-0.01em;text-align:left}
.ct-l-terminal .lead::before{content:"❯ ";color:var(--ct-accent)}
.ct-l-terminal .opener--center{align-items:flex-start;text-align:left}
.ct-l-terminal .h-title{font-family:${a.fontMono};font-size:clamp(18px,3vw,24px);border-left:3px solid var(--ct-accent);padding-left:12px}`,
    magazine: `
/* 版式基因·magazine:巨型粗黑标题、反居中堆叠——杂志封面气质 */
.ct-l-magazine .lead{font-size:clamp(38px,7.6vw,72px);font-weight:900;letter-spacing:-0.03em;line-height:1.05;text-align:left}
.ct-l-magazine .opener--center{align-items:flex-start;text-align:left}
.ct-l-magazine .opener--center .body{margin-left:0;margin-right:0}
.ct-l-magazine .h-title{font-size:clamp(25px,4.4vw,34px);font-weight:850;letter-spacing:-0.02em}`,
    zen: `
/* 版式基因·zen:细字重、宽字距、发丝线、大留白——禅意气质 */
.ct-l-zen .lead{font-weight:500;letter-spacing:.05em;font-size:clamp(25px,4.4vw,38px)}
.ct-l-zen .h-title{font-weight:600;letter-spacing:.09em;font-size:clamp(17px,2.8vw,22px)}
.ct-l-zen .h-title::after{content:"";display:block;width:28px;height:1px;background:var(--ct-accent);margin-top:10px}
.ct-l-zen .page--surface,.ct-l-zen .page--band{padding:clamp(26px,5vw,46px)}`,
  };
  const motion: Record<ArtDirection["motion"], string> = {
    rise: "", // 默认基线(淡入上浮)在 baseCss
    draw: `
/* 动效签名·draw:内容自左向右「描画」显影(clip-path 揭示),标题下划线随之生长 */
.ct-js .ct-m-draw [data-reveal]{opacity:0;transform:none;clip-path:inset(0 92% 0 0);transition:opacity .5s var(--ct-ease),clip-path .8s var(--ct-ease)}
.ct-js .ct-m-draw [data-reveal].in{opacity:1;clip-path:inset(0 0 0 0)}
.ct-js .ct-m-draw .h-title{border-image:linear-gradient(90deg,var(--ct-accent),var(--ct-accent)) 1;border-image-width:0 0 2px 0}`,
    type: `
/* 动效签名·type:终端逐档浮现(steps 时序,机械感)+ 开场光标 */
.ct-js .ct-m-type [data-reveal]{opacity:0;transform:translateY(8px);transition:opacity .42s steps(7),transform .42s steps(7)}
.ct-js .ct-m-type [data-reveal].in{opacity:1;transform:none}
.ct-js .ct-m-type [data-stagger]>*{transition-timing-function:steps(5),steps(5)}
.ct-js .ct-m-type .opener .lead::after{content:"▊";margin-left:6px;color:var(--ct-accent);animation:ctCaret 1.1s steps(1) infinite}
@keyframes ctCaret{50%{opacity:0}}`,
    curtain: `
/* 动效签名·curtain:自上而下缓幕揭示,拉长节奏,剧场感 */
.ct-js .ct-m-curtain [data-reveal]{opacity:0;transform:translateY(-14px);transition:opacity .9s var(--ct-ease),transform .9s var(--ct-ease)}
.ct-js .ct-m-curtain [data-reveal].in{opacity:1;transform:none}
.ct-js .ct-m-curtain [data-stagger].in>*{transition-delay:calc(var(--i,0) * 140ms)}`,
    slide: `
/* 动效签名·slide:大块横向滑入,奇偶交替方向——版面有冲击力 */
.ct-js .ct-m-slide [data-reveal]{opacity:0;transform:translateX(-30px);transition:opacity .55s var(--ct-ease),transform .55s var(--ct-ease)}
.ct-js .ct-m-slide .deck>section:nth-of-type(even) [data-reveal]{transform:translateX(30px)}
/* 揭示态必须压过上面按奇偶分支的隐藏态(同高特异性,靠书写顺序取胜)——否则 .in 后仍停在位移/透明,整页无字 */
.ct-js .ct-m-slide .deck>section:nth-of-type(odd) [data-reveal].in,
.ct-js .ct-m-slide .deck>section:nth-of-type(even) [data-reveal].in,
.ct-js .ct-m-slide [data-reveal].in{opacity:1;transform:none}`,
  };
  return layout[a.layout] + motion[a.motion];
}

/** 包成渲染契约 DTO（含 sha256 校验和；hasScript 恒 true，因含入场/交互/高度上报脚本）。 */
export function buildContract(html: string): CoursewareContract {
  const checksum = "sha256:" + createHash("sha256").update(html, "utf8").digest("hex");
  return { renderMode: "sandbox_srcdoc", contractVersion: HTML_CONTRACT_VERSION, html, hasScript: true, checksum };
}

// ————————————————————————————————————————————————————————————
//  bespoke 协议壳（蓝图 A5）—— LLM 产物不实现宿主协议，由平台注入
// ————————————————————————————————————————————————————————————

/**
 * bespoke 适配脚本：LLM 的 bespoke HTML 是「孤岛页」——不发 ct-height 会卡在宿主 560px 兜底高度，
 * 不响应 ct-hello 握手，quiz 结果也不回传。此脚本注入后补齐三件事（滚动语义，不冒充翻页能力，
 * 故**不发 ct-ready**——宿主对无 ct-ready 的课件正确回落滚动模式）：
 *  1) ct-height 高度上报（load + ResizeObserver + 定时重播 + 响应 ct-hello/ct-mode）；
 *  2) ct-quiz 判分回传：约定 .quiz[data-answer]>.opt 结构（prompt 已要求），捕获阶段监听不干扰模型自带 JS；
 *  3) ct-flash 翻卡回传：.fc 点击首次上报。
 */
const BESPOKE_ADAPTER_SCRIPT = `
(function(){
  if (window.__ctBespokeAdapter) return; window.__ctBespokeAdapter = true;
  function h(){ try{ return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0); }catch(e){ return 0; } }
  function post(m){ try{ parent.postMessage(m, '*'); }catch(e){} }
  function announce(){ var v = h(); if (v > 0) post({type:'ct-height', height: v}); }
  window.addEventListener('message', function(e){ var d = e.data || {}; if (d.type === 'ct-hello' || d.type === 'ct-mode') announce(); });
  window.addEventListener('load', announce);
  if ('ResizeObserver' in window) { try{ new ResizeObserver(announce).observe(document.documentElement); }catch(e){} }
  setTimeout(announce, 300); setTimeout(announce, 1200);
  document.addEventListener('click', function(ev){
    var t = ev.target;
    while (t && t !== document && !(t.classList && t.classList.contains('opt'))) t = t.parentNode;
    if (!t || t === document) return;
    var q = t.closest ? t.closest('.quiz[data-answer]') : null;
    if (!q || q.__ctReported) return;
    var opts = q.querySelectorAll('.opt'); var idx = -1;
    for (var i = 0; i < opts.length; i++) if (opts[i] === t) idx = i;
    var ans = parseInt(q.getAttribute('data-answer'), 10);
    if (idx >= 0 && !isNaN(ans)) { q.__ctReported = true; post({type:'ct-quiz', bid: q.getAttribute('data-bid') || null, answer: idx, correct: idx === ans}); }
  }, true);
  document.addEventListener('click', function(ev){
    var t = ev.target && ev.target.closest ? ev.target.closest('.fc') : null;
    if (t && !t.__ctFlipped) { t.__ctFlipped = true; post({type:'ct-flash', bid: t.getAttribute('data-bid') || null}); }
  }, true);
})();
`;

/** 给 bespoke HTML 注入协议壳（幂等；无 </body> 时追加到尾部）。在 enforceTrustedCsp 之后调用。 */
export function injectBespokeAdapter(html: string): string {
  const h = html || "";
  if (h.includes("__ctBespokeAdapter")) return h;
  const tag = `<script data-ct-bespoke-adapter>${BESPOKE_ADAPTER_SCRIPT}</script>`;
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, `${tag}</body>`) : h + tag;
}

// ————————————————————————————————————————————————————————————
//  安全 / 反 slop 校验（LLM 增强路径的产物必须过此门，否则回落确定性渲染器）
// ————————————————————————————————————————————————————————————

export interface CoursewareLint {
  ok: boolean;
  issues: string[];
}

/** 蓝图 A4：lint 分级 —— security 一票拒收；style 只记录（能自愈的先过 normalizeCoursewareStyle）。 */
export interface CoursewareLintSplit {
  security: string[];
  style: string[];
}

/**
 * 机检分级（蓝图 A4）：把原「任一违规整节拒收」拆成两级——
 * security：CSP/外链/网络调用等硬底线，违者拒收回落确定性渲染（不变）；
 * style：字体/投影/纯黑白底/scroll 监听/layout 动画/占位垃圾/营销词等观感与性能问题，
 *        不再整节拒收（此前 chat 已产出的 HTML 有 3/7 节因一条投影 lint 被白扔，评估 §三.4），
 *        可修的由 normalizeCoursewareStyle 后处理归一，其余仅记录观测。
 */
export function splitCoursewareLint(html: string): CoursewareLintSplit {
  const security: string[] = [];
  const style: string[] = [];
  const h = html || "";

  // —— 安全硬门（拒收）——
  if (!/Content-Security-Policy/i.test(h)) security.push("缺少 CSP meta");
  if (!/connect-src\s+'none'/i.test(h)) security.push("CSP 未掐断网络(connect-src 'none')");
  // 外链资源（http/https 或协议相对 //host）——课件必须自包含、无外链
  if (/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(h)) security.push("含外链资源(src/href 外链)");
  if (/url\(\s*["']?(?:https?:)?\/\//i.test(h)) security.push("CSS 含外链 url()");
  if (/\.(?:src|href)\s*=\s*["'][^"']*\/\//i.test(h)) security.push("JS 赋值外链(.src/.href //)");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/.test(h)) security.push("含网络调用(fetch/XHR/WS)");
  // 审计修复：scroll 监听与 layout 属性动画是不可机械自愈的性能硬伤（低端机掉帧发热），
  // 保持一票拒收（归 security 桶=拒收桶），不随风格软门放行。
  if (/addEventListener\(\s*["']scroll["']/.test(h)) security.push("用了 scroll 监听(性能杀手)");
  if (/@keyframes[^}]*\b(?:top|left|width|height)\s*:/i.test(h)) security.push("动画了 layout 属性(非 GPU 安全)");

  // —— 风格软门（自愈或记录）——
  if (!/prefers-reduced-motion/i.test(h)) style.push("缺少 reduce-motion 分支");
  if (/font-family[^;}]*\b(Inter|Roboto|Arial|Open Sans|Helvetica)\b/i.test(h)) style.push("使用了廉价默认字体");
  // 审计修复：只认「shadow 声明里的纯黑」为硬黑投影——正文色/遮罩的 rgba(0,0,0,.x) 是合法用法，
  // 原全局匹配会把 color:rgba(0,0,0,.85) 也判违规并被自愈改淡到不可读。
  if (/(?:box-shadow|text-shadow)[^;}]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[1-9]/i.test(h)) style.push("硬黑投影(shadow 用纯黑)");
  if (/background[^;}]*#(?:000000|000|ffffff|fff)\b/i.test(h)) style.push("纯黑/纯白背景");
  if (/John Doe|Lorem Ipsum|Acme\b/i.test(h)) style.push("含占位垃圾");
  if (/颠覆认知|全网最强|小白秒变|Unleash|Seamless|Next-Gen/i.test(h)) style.push("含 AI 陈词/夸张营销");

  return { security, style };
}

/** 机检一段课件 HTML 的安全与反 slop 底线（见计划 §4机制三 / §7）。确定性渲染器的产物应恒过此门。 */
export function validateCoursewareHtml(html: string): CoursewareLint {
  const { security, style } = splitCoursewareLint(html);
  const issues = [...security, ...style];
  return { ok: issues.length === 0, issues };
}

/**
 * 蓝图 A4：风格软违规后处理自愈——把可机械修正的 style lint 直接改到 HTML 里，
 * 保住 LLM 已产出的整节 bespoke，而不是拒收白扔。修正全部替换为中性安全值
 * （不猜设计意图，只消除违规本身）；不可机械修正的项（scroll 监听/营销词等）留给 lint 观测。
 */
export function normalizeCoursewareStyle(html: string): { html: string; fixes: string[] } {
  let h = html || "";
  const fixes: string[] = [];

  // 硬黑投影 → 带色相投影色。审计修复：只改 box-shadow/text-shadow 声明内的纯黑，
  // 且**保留原透明度**——原实现全局替换并把 α 钉死 .10，会把正文色 rgba(0,0,0,.85)、
  // 弹层遮罩 rgba(0,0,0,.6) 一并改到近乎不可见。
  if (/(?:box-shadow|text-shadow)[^;}]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.[1-9]/i.test(h)) {
    h = h.replace(/((?:box-shadow|text-shadow)[^;}]*)/gi, (decl) =>
      decl.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0?\.\d+)\s*\)/gi, "rgba(18,24,32,$1)"),
    );
    fixes.push("shadow 纯黑→带色相投影色(保留透明度)");
  }

  // 廉价默认字体 → system-ui（只动 font-family 声明内的字体名，不碰正文文字）
  if (/font-family[^;}]*\b(Inter|Roboto|Arial|Open Sans|Helvetica)\b/i.test(h)) {
    h = h.replace(/(font-family[^;}]*)/gi, (decl) =>
      decl.replace(/\b(Inter|Roboto|Arial|Open Sans|Helvetica)\b/gi, "system-ui"),
    );
    fixes.push("廉价字体→system-ui");
  }

  // 纯黑/纯白背景 → 近黑/暖白（保留背景声明结构，只替换 hex）
  if (/background[^;}]*#(?:000000|000|ffffff|fff)\b/i.test(h)) {
    h = h.replace(/(background[^;}]*?)#(000000|000)\b/gi, "$1#0c0f14");
    h = h.replace(/(background[^;}]*?)#(ffffff|fff)\b/gi, "$1#fcfbf7");
    fixes.push("纯黑/纯白背景→近黑/暖白");
  }

  // 缺 reduce-motion → 注入全局降级分支（放 </head> 前，对整页动画/过渡一刀切降级）
  if (!/prefers-reduced-motion/i.test(h)) {
    const inject =
      "<style>@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style>";
    h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${inject}</head>`) : inject + h;
    fixes.push("注入 reduce-motion 降级");
  }

  return { html: h, fixes };
}

// ————————————————————————————————————————————————————————————
//  多样性机检闸门（LLM 增强产物专用）—— 吸收模板侦察的「剪影测试」思想
// ————————————————————————————————————————————————————————————

export interface CoursewareDiversity {
  svgCount: number;
  sectionCount: number;
  distinctBackgrounds: number;
  textLen: number;
  substantial: boolean;
  ok: boolean;
  reasons: string[];
}

/** 蓝图 C2：视觉高级分（0-100，确定性可测指标聚合）。低分触发 C1 回炉，入 qualityJson.visual 供看板。 */
export interface CoursewareVisualScore {
  score: number;
  metrics: {
    distinctBackgrounds: number;
    svgCount: number;
    sectionCount: number;
    textLen: number;
    avgTextPerSection: number;
  };
}

/**
 * 视觉高级分：不判美丑（那是人审的事），只量「有没有做设计动作」的确定性信号——
 * 表面分化（背景种类）、图形量（内联 SVG）、分区节奏（section 数）、密度（每区文字量落在可读带）。
 * 阈值经 12 art 快照基线校准：确定性渲染器产物恒 ≥70；纯文字墙 ≤45。
 */
export function scoreCoursewareVisual(html: string): CoursewareVisualScore {
  const d = assessCoursewareDiversity(html);
  const sections = Math.max(1, d.sectionCount);
  const avg = Math.round(d.textLen / sections);
  let score = 40;
  score += Math.min(20, d.distinctBackgrounds * 2); // 表面分化
  score += Math.min(12, d.svgCount * 4); // 图形动作
  score += d.sectionCount >= 6 ? 14 : d.sectionCount >= 3 ? 8 : 0; // 分区节奏
  score += avg >= 60 && avg <= 700 ? 14 : avg > 0 ? 6 : 0; // 密度可读带
  return {
    score: Math.max(0, Math.min(100, score)),
    metrics: {
      distinctBackgrounds: d.distinctBackgrounds,
      svgCount: d.svgCount,
      sectionCount: d.sectionCount,
      textLen: d.textLen,
      avgTextPerSection: avg,
    },
  };
}

/**
 * 评估一段 bespoke 课件 HTML 的「视觉分化度」（防 LLM 产出纯文字墙/同底色堆叠）。
 * 通用启发（不依赖我方类名，也不依赖 <section> 计数——LLM 可能用 div/article 包文字墙）：
 * 按**正文体量**（去标签后可见文字长度，或区块数）触发闸门；达标产物需满足「有内联 SVG 图形 **或** 背景/表面有分化」，
 * 二者皆无即判为纯文字墙/同底色堆叠 → 建议拒收回落确定性渲染器（它天生分化）。允许合法的纯排版讲义（靠背景分化过关）。
 */
export function assessCoursewareDiversity(html: string): CoursewareDiversity {
  const h = html || "";
  const svgCount = (h.match(/<svg[\s>]/gi) || []).length;
  const sectionCount = (h.match(/<section[\s>]/gi) || []).length;
  const bgs = new Set(
    (h.match(/background(?:-color|-image)?\s*:\s*[^;"}]+/gi) || []).map((s) => s.toLowerCase().replace(/\s+/g, "")),
  );
  const distinctBackgrounds = bgs.size;
  // 去标签后的可见文字长度（不依赖 section）：div/article 包裹的文字墙同样能被量到体量。
  const textLen = h
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
  const blockCount = (h.match(/<(?:section|article|div)[\s>]/gi) || []).length;
  const substantial = textLen >= 400 || sectionCount >= 4 || blockCount >= 6;
  const reasons: string[] = [];
  if (substantial && svgCount === 0 && distinctBackgrounds < 2) {
    reasons.push("既无内联 SVG 图形、背景/表面也无分化（纯文字墙/同底色堆叠，未破单调）");
  }
  return { svgCount, sectionCount, distinctBackgrounds, textLen, substantial, ok: reasons.length === 0, reasons };
}
