/**
 * 课件数学公式（v4.3，吸收 KaTeX，MIT）—— formula 块的服务端渲染 + 自包含字体。
 *
 * CSP 自包含铁律的落法：
 *  - `katex.renderToString` 产出的是纯 HTML（MathML + span），零脚本零外链，天然过安全 lint；
 *  - KaTeX 的排版 CSS 原本用 `url(fonts/…woff2)` 引外链字体 → 在沙箱 srcdoc 里加载不到、且违反 CSP。
 *    这里**剥掉 katex.css 的 @font-face**，改成把必要 woff2 **base64 内联**为 data: 字体
 *    （CSP 已允 `font-src data:`），保证公式符号在无网络的 iframe 内也正确显示；
 *  - 体积按需：只有含 formula 块的课节才注入这套 CSS+字体（约 base64 后 ~180KB），
 *    无公式的课零成本。字体只挑覆盖绝大多数公式的必要子集。
 *
 * 全部懒加载 + 记忆化：首次渲染公式时读盘构建一次，之后命中缓存；读盘失败则回落纯文本 latex，绝不抛。
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import katex from "katex";

const require_ = createRequire(import.meta.url);

/** 覆盖绝大多数公式的必要字体子集（变量/符号/大运算符/定界符/粗斜体）。其余生僻族按需再加。 */
const ESSENTIAL_FONTS = [
  "KaTeX_Main-Regular", "KaTeX_Main-Bold", "KaTeX_Main-Italic", "KaTeX_Main-BoldItalic",
  "KaTeX_Math-Italic", "KaTeX_Math-BoldItalic",
  "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular", "KaTeX_Size4-Regular",
  "KaTeX_AMS-Regular",
  "KaTeX_Caligraphic-Regular", "KaTeX_Caligraphic-Bold",
  "KaTeX_Fraktur-Regular", "KaTeX_Fraktur-Bold",
  "KaTeX_SansSerif-Regular", "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Bold",
  "KaTeX_Script-Regular",
  "KaTeX_Typewriter-Regular",
];

/** 从字体名解析 font-weight/style（KaTeX 命名约定：…-Bold/Italic/BoldItalic/Regular）。 */
function faceAttrs(name: string): { weight: string; style: string } {
  const bold = /Bold/.test(name);
  const italic = /Italic/.test(name);
  return { weight: bold ? "bold" : "normal", style: italic ? "italic" : "normal" };
}

let cachedCss: string | null = null;
let cssBuildTried = false;

/**
 * 构建自包含 KaTeX CSS（katex.css 去 @font-face + base64 字体 @font-face）。懒执行、记忆化。
 * 失败（找不到 katex 资源）→ 返回 ""，公式改回落纯文本，不阻断渲染。
 */
export function katexSelfContainedCss(): string {
  if (cachedCss !== null) return cachedCss;
  if (cssBuildTried) return "";
  cssBuildTried = true;
  try {
    const katexCssPath = require_.resolve("katex/dist/katex.min.css");
    const fontsDir = join(dirname(katexCssPath), "fonts");
    const rawCss = readFileSync(katexCssPath, "utf8");
    // 剥掉全部 @font-face 块（它们引相对 url 外链字体）。
    const cssNoFonts = rawCss.replace(/@font-face\s*\{[^}]*\}/g, "");
    const faces = ESSENTIAL_FONTS.map((name) => {
      const b64 = readFileSync(join(fontsDir, `${name}.woff2`)).toString("base64");
      const family = name.split("-")[0]; // KaTeX_Main-Bold → KaTeX_Main
      const { weight, style } = faceAttrs(name);
      return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    }).join("");
    cachedCss = faces + cssNoFonts;
    return cachedCss;
  } catch {
    return "";
  }
}

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 渲染一个公式为自包含 HTML。latex 非法/KaTeX 报错 → 回落为等宽纯文本（不抛、不留破渲染）。
 * @param display 独立居中公式（true）或行内（false）。
 */
export function renderFormula(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: display,
      output: "html", // 只出 html span（不带 mathml，减体积；无障碍另由 caption/上下文兜）
      strict: "ignore",
    });
  } catch {
    return `<code class="ct-formula-fallback">${escText(latex)}</code>`;
  }
}
