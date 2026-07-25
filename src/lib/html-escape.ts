/**
 * HTML 文本转义 —— 全仓唯一真值源（2026-07-21 统一）。
 *
 * 背景：此前全仓有 6 份各自为政的 `esc()` 拷贝，其中 markdown.ts / courseware-diagrams.ts /
 * courseware-math.ts / courseware-highlight.ts 四份**漏转义单引号**（只处理 & < > "），
 * 而 courseware-html.ts 的注释把「所有输出文本恒经 esc」写成 XSS 不变量——该不变量只对它自己成立。
 * 单引号在 `<div attr='...'>` 这类单引号属性上下文里可闭合属性；虽然本仓当前模板都用双引号，
 * 但让「转义函数的安全等级取决于你随手 import 了哪一份拷贝」本身就是不该存在的风险。
 *
 * 语义取最严的一份（原 courseware-html 版）：
 *  - 入参 unknown 容错（null/undefined → ""，避免 "undefined" 字面量漏进页面）；
 *  - 转义 5 个字符：& < > " '（& 必须最先，否则会二次转义后面产生的实体）。
 */
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
