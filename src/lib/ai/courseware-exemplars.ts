/**
 * LLM 增强 few-shot 范例库（v3.5）—— 吸收开源模板侦察的「用范例锚定上限」思想。
 *
 * synthesizeViaLLM 把这里的**黄金骨架**作为 few-shot 注入：给模型一个「自包含 + CSP 合规 + 页型分化 +
 * 内联 SVG 图形 + 终端镜框 + reduced-motion」都齐全的结构范本，让 bespoke HTML 对标它的**结构与完备度**
 * （风格仍按本课艺术方向/mode，不照抄内容）。范例用本课设计 token 生成，天然与目标风格一致。
 *
 * 纯函数、无 IO；范例本身也满足 validateCoursewareHtml 的安全底线（示范给模型看）。
 */

import type { CourseDesign } from "./courseware-design";
import type { CoursewareMode } from "./courseware-catalog";

/**
 * 黄金骨架：一页多态课件的**结构范本**（不是内容，是骨架）。演示 6 个必备要素：
 * ① CSP meta；② 页型分化（hero 满版 + band 色带 + surface 卡）；③ 内联 SVG 母题（无外链图）；
 * ④ 逐条揭示的列表；⑤ 终端镜框代码；⑥ prefers-reduced-motion 降级。
 */
export function goldenExemplar(design: CourseDesign): string {
  const a = design.art;
  return [
    "<!-- 黄金骨架示例：对标其「自包含 + 页型分化 + 内联SVG + 终端 + reduce-motion」的完备度，风格按本课方向重做 -->",
    '<!doctype html><html><head>',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    "<style>",
    `:root{--bg:${a.bg};--ink:${a.ink};--accent:${a.accent};--surface:${a.surface};--border:${a.border}}`,
    `body{background:var(--bg);color:var(--ink);font-family:${a.fontBody};margin:0}`,
    `h1,h2{font-family:${a.fontDisplay};letter-spacing:${a.displayTracking}}`,
    "[data-in]{opacity:0;transform:translateY(18px);transition:opacity .6s,transform .6s}[data-in].on{opacity:1;transform:none}",
    "@media (prefers-reduced-motion:reduce){[data-in]{opacity:1!important;transform:none!important;transition:none}}",
    ".band{background:var(--accent);color:#fff;padding:32px;border-radius:16px}",
    ".term{border:1px solid var(--border);border-radius:12px;overflow:hidden}.term .bar{padding:8px 12px;border-bottom:1px solid var(--border)}",
    "</style></head><body>",
    "<!-- ① hero 满版 + 内联SVG母题作背景（禁外链图，图形一律内联SVG/CSS） -->",
    '<section data-in style="position:relative;min-height:60vh;display:flex;align-items:flex-end;padding:48px">',
    `<svg viewBox="0 0 400 300" style="position:absolute;inset:0;width:100%;height:100%;opacity:.18" xmlns="http://www.w3.org/2000/svg"><circle cx="320" cy="70" r="90" fill="${a.accent}"/></svg>`,
    '<h1 style="position:relative;font-size:clamp(40px,8vw,80px);max-width:14ch">一句核心主张</h1></section>',
    "<!-- ② band 通栏色带断言（全案唯一大面积用色处） -->",
    '<section data-in class="band"><h2>一句要点断言</h2></section>',
    "<!-- ③ 逐条揭示的清单（每条 data-in，可分步显现） -->",
    '<section data-in><ul><li data-in>要点一</li><li data-in>要点二</li><li data-in>要点三</li></ul></section>',
    "<!-- ④ 终端镜框代码（交通灯 + 行号感） -->",
    '<section data-in><div class="term"><div class="bar">python</div><pre style="padding:12px;margin:0">def f(x):\n    return x*2</pre></div></section>',
    "<script>document.querySelectorAll('[data-in]').forEach(function(e){new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting)x.target.classList.add('on')})}).observe(e)})</script>",
    "</body></html>",
  ].join("\n");
}

/** 各 mode 的一句「结构侧重」提示，配合 goldenExemplar 一起注入（比骨架更针对当前内容类型）。 */
const MODE_EXEMPLAR_NOTE: Partial<Record<CoursewareMode, string>> = {
  "developer-training": "代码课：多用终端镜框 + 命令/输出对照 + 步骤即「照着敲」，冷静专业。",
  "cinematic-tech": "发布会风：深色巨型标题 + 大留白 + 发光强调，情绪化开场收束。",
  "editorial-academic": "讲义风：衬线标题 + 页边栏/细分隔线 + 高信息密度但层级清晰。",
  "interactive-quiz": "测验风：随堂测/记忆卡为主，即时判分反馈明确。",
  "spatial-concept-map": "图谱风：内联 SVG 画节点与连线，一核多象的空间布局。",
  "course-dashboard": "仪表盘风：模块卡片网格 + 进度可视，一眼看清学到哪。",
};

/** 取某 mode 的范例补充说明（无则空串）。 */
export function exemplarNoteFor(mode: CoursewareMode): string {
  return MODE_EXEMPLAR_NOTE[mode] ? `\n【本 mode 结构侧重】${MODE_EXEMPLAR_NOTE[mode]}` : "";
}
