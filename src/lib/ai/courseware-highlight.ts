/**
 * 课件代码高亮（v4.4，吸收 shikijs/shiki，MIT）—— VS Code 同源 TextMate 语法着色。
 *
 * 关键工程约束与它的解法：
 *  - 课件 HTML 自包含、CSP 禁外链、禁运行时 JS —— shiki 在**服务端渲染期**把代码分词成
 *    带 inline color 的 span，产物是纯静态 HTML，iframe 内零依赖零脚本，天然过安全 lint；
 *  - renderCoursewareHtml 是**同步**函数 —— shiki 的 highlighter 一旦异步创建完成，
 *    `codeToTokens` 即同步。故这里用「异步建单例 + 同步取 token」两段式：
 *    渲染主链（async）先 `await ensureHighlighter()`，之后同步渲染里的 `highlightLinesSync` 直接可用；
 *    未 ensure 的纯同步场景（个别测试）优雅回落 null，由调用方走旧的手写高亮，绝不抛错。
 *
 * 客户端零增重：shiki 只在服务端 node_modules 里，产物只是着色后的 HTML。
 */

import type { Highlighter, BundledLanguage } from "shiki";

/** 课程里常见语言（多装无害，仅服务端内存；未列出的语言按 text 降级）。 */
const LANGS = [
  "python", "javascript", "typescript", "tsx", "jsx", "json", "bash", "shell",
  "sql", "html", "css", "java", "go", "rust", "c", "cpp", "csharp", "php", "ruby",
  "yaml", "markdown", "plaintext",
] as const;

const THEME_LIGHT = "github-light";
const THEME_DARK = "github-dark";

/** 语言别名归一（LLM/用户常写简称）。未识别 → text（纯文本，仍走镜框+行号，不报错）。 */
const LANG_ALIAS: Record<string, string> = {
  js: "javascript", ts: "typescript", py: "python", sh: "bash", shell: "bash",
  "c++": "cpp", "c#": "csharp", cs: "csharp", golang: "go", rb: "ruby",
  yml: "yaml", md: "markdown", text: "plaintext", plain: "plaintext", "": "plaintext",
};
const LANG_SET = new Set<string>(LANGS);

function normalizeLang(lang: string | undefined): string {
  const k = String(lang || "").trim().toLowerCase();
  const mapped = LANG_ALIAS[k] ?? k;
  return LANG_SET.has(mapped) ? mapped : "plaintext";
}

let singleton: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

/** 异步建/取单例 highlighter（幂等；并发调用共享同一次加载）。渲染主链在同步渲染前 await 一次即可。 */
export async function ensureHighlighter(): Promise<Highlighter> {
  if (singleton) return singleton;
  if (!loading) {
    loading = import("shiki")
      .then((m) => m.createHighlighter({ themes: [THEME_LIGHT, THEME_DARK], langs: [...LANGS] }))
      .then((hl) => {
        singleton = hl;
        return hl;
      })
      .catch((e) => {
        // 失败重置(审计 P3)：不重置的话 rejected promise 被永久缓存,一次瞬时失败(冷启动抖动)
        // 会让 shiki 到进程重启前都熄火。重置后下次调用重试;期间回落手写高亮。
        loading = null;
        throw e;
      });
  }
  return loading;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 同步把代码切成「逐行 inner HTML」（带 inline color 的 span），供课件终端镜框逐行渲染。
 * @returns 每行的 inner HTML 数组；highlighter 未就绪或异常 → null（调用方回落手写高亮）。
 */
export function highlightLinesSync(code: string, lang: string | undefined, dark: boolean): string[] | null {
  if (!singleton) return null;
  try {
    const theme = dark ? THEME_DARK : THEME_LIGHT;
    // normalizeLang 已保证结果在已加载语言集内（否则回落 plaintext），这里安全窄化到 BundledLanguage。
    const { tokens } = singleton.codeToTokens(code ?? "", { lang: normalizeLang(lang) as BundledLanguage, theme });
    return tokens.map((line) => {
      if (line.length === 0) return "";
      return line
        .map((t) => {
          const content = esc(t.content);
          const style: string[] = [];
          if (t.color) style.push(`color:${t.color}`);
          // fontStyle 位掩码：1=italic 2=bold 4=underline（shiki FontStyle）。
          if (typeof t.fontStyle === "number") {
            if (t.fontStyle & 1) style.push("font-style:italic");
            if (t.fontStyle & 2) style.push("font-weight:600");
            if (t.fontStyle & 4) style.push("text-decoration:underline");
          }
          return style.length ? `<span style="${style.join(";")}">${content}</span>` : content;
        })
        .join("");
    });
  } catch {
    return null; // 语言/主题异常 → 回落手写高亮，绝不阻断渲染
  }
}
