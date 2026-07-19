/**
 * 轻量 Markdown → HTML（无外部依赖，够用于笔记渲染）。
 * 支持：标题、粗斜体、行内代码、代码块、引用、无序/有序列表、链接、换行。
 * 输出前对原始文本做 HTML 转义，避免 XSS。
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { hetiSpacing } from "./cjk-spacing";

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = esc(src).split("\n");
  const out: string[] = [];
  let inCode = false;
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { closeList(); out.push('<pre class="tide-md-pre"><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(line); continue; }

    if (/^#{1,3}\s/.test(line)) {
      closeList();
      const level = line.match(/^#+/)![0].length;
      out.push(`<h${level + 2} class="tide-md-h">${inline(line.replace(/^#+\s/, ""))}</h${level + 2}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote class="tide-md-quote">${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      if (listType !== "ul") { closeList(); out.push('<ul class="tide-md-ul">'); listType = "ul"; }
      out.push(`<li>${inline(line.replace(/^[-*]\s/, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      if (listType !== "ol") { closeList(); out.push('<ol class="tide-md-ol">'); listType = "ol"; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s/, ""))}</li>`);
      continue;
    }
    if (line.trim() === "") { closeList(); continue; }
    closeList();
    out.push(`<p class="tide-md-p">${inline(line)}</p>`);
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  // heti CJK⇄半角自动间距（标签感知，跳过 pre/code；空 span 纯视觉，不改文本）。
  return hetiSpacing(out.join("\n"));
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="tide-md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="link-underline text-accent-700">$1</a>');
}
