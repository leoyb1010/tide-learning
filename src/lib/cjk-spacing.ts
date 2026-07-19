/**
 * CJK ⇄ 拉丁/数字 自动间距（v4.4，吸收 sivan/heti 赫蹏的排版规则，MIT）。
 *
 * heti 的核心价值之一：中文与半角(英文/数字/部分符号)之间补一个约 1/8 em 的空隙，
 * 让「学习 English 课程」「共 89 节」之类混排不再挤成一团。现代浏览器有 `text-autospace`
 * 原生支持，但覆盖面有限；这里在**服务端渲染期**对内容文本做等效标注，保证跨端一致。
 *
 * 铁律：
 *  - 标签感知：只在**文本节点**里插入间距标注，绝不碰 `<...>` 标签内部、`<script>`/`<style>` 内容、
 *    以及 HTML 实体，避免破坏结构与脚本；
 *  - 用空的 `<span class="hs"></span>`（CSS 给 margin）而非真实空格字符 → 不改变文本内容，
 *    复制/检索/朗读都拿到原文，纯视觉留白（与 heti 的 spacing 元素同理）；
 *  - 幂等：已插入的 `hs` 标记不会二次触发（span 边界不构成 CJK↔半角相邻）。
 */

// 中日韩统一表意文字（含扩展 A 常用区）+ 常用中文标点归入「全角」侧，不参与半角间距。
const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
// 半角侧：拉丁字母、数字、以及会与中文贴合的少数符号（@#$%&）。
const HALF = "A-Za-z0-9@#$%&";

const SPACER = '<span class="hs"></span>';

// CJK 后紧跟半角，或半角后紧跟 CJK。用捕获组回填，中间插入间距标注。
const RE_CJK_HALF = new RegExp(`([${CJK}])([${HALF}])`, "g");
const RE_HALF_CJK = new RegExp(`([${HALF}])([${CJK}])`, "g");

function spaceTextRun(text: string): string {
  return text.replace(RE_CJK_HALF, `$1${SPACER}$2`).replace(RE_HALF_CJK, `$1${SPACER}$2`);
}

/**
 * 给一段 HTML 的文本节点插入 CJK↔半角间距标注（标签感知）。
 * 跳过 `<script>`/`<style>` 整块与所有标签内部；HTML 实体（&…;）作为整体不拆分。
 */
export function hetiSpacing(html: string): string {
  if (!html) return "";
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += spaceTextRun(html.slice(i));
      break;
    }
    // 文本段 [i, lt)
    if (lt > i) out += spaceTextRun(html.slice(i, lt));

    // 跳过 script/style/pre/code 整块（脚本原样、代码等宽不加间距，绝不注入）。
    const blockMatch = /^<(script|style|pre|code)\b/i.exec(html.slice(lt));
    if (blockMatch) {
      const tag = blockMatch[1].toLowerCase();
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const closeAt = html.slice(lt).search(closeRe);
      if (closeAt === -1) {
        out += html.slice(lt);
        break;
      }
      const end = lt + closeAt + `</${tag}>`.length;
      out += html.slice(lt, end);
      i = end;
      continue;
    }

    // 普通标签：原样保留到 '>'。
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    out += html.slice(lt, gt + 1);
    i = gt + 1;
  }
  return out;
}

/** heti 间距标注的 CSS（约 1/8 em 视觉留白；空 span，纯 margin）。课件与全站 prose 通用。 */
export const HETI_SPACING_CSS = ".hs{margin-left:.12em}";
