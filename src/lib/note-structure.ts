/**
 * note-structure —— 导入类笔记的文本结构化共享逻辑。
 *
 * 从 /api/notes/import-url 抽出，供 import-url（HTML 正文）与 import-pdf（PDF 抽出的纯文本）复用。
 * 不引入任何解析器依赖：htmlToStructuredMarkdown 走调用方已解析好的 jsdom Document；
 * paragraphizePlainText 是零依赖的纯文本分段兜底。
 *
 * 目的与 import-url 保持一致：把断行救回来，产出块级结构化的 Markdown，
 * 前端 renderMarkdown + tide-md 才能识别独立段落、套上排版；不追求富文本还原。
 */

/**
 * 纯文本 → 分段 Markdown。
 * 优先按空行分段；若整段无空行，退而按单换行分段，避免所有内容堆成一坨。
 * import-url 用于 Readability 只吐 textContent 的兜底；import-pdf 用于 PDF 抽出的整篇文本。
 */
export function paragraphizePlainText(text: string): string {
  const t = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t) return "";
  // 有空行：按空行分段，段内换行折叠为空格
  if (/\n\s*\n/.test(t)) {
    return t
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  // 无空行：按单换行切成段（去掉纯空白行）
  return t
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 结构化 HTML → 保结构 Markdown。零依赖，走调用方已解析的 jsdom Document。
 * 只做块级结构化（段落 / h1-h6 / 列表 / 引用 / 代码块 / 分隔线）——把断行救回来，
 * 不追求富文本还原（行内加粗/链接等由前端 renderMarkdown + tide-md 承接）。
 * 每个块之间以空行分隔，前端 renderMarkdown 才能识别为独立段落、套上 tide-md 排版。
 *
 * 注意：doc 需与 contentHtml 同源（同一 jsdom Document），本函数用 doc.createElement 建临时容器。
 */
export function htmlToStructuredMarkdown(contentHtml: string, doc: Document): string {
  const container = doc.createElement("div");
  container.innerHTML = contentHtml;

  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const blocks: string[] = [];

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      switch (tag) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6": {
          const lvl = Math.min(3, Number(tag[1])); // renderMarkdown 仅识别 #{1,3}
          const txt = clean(child.textContent ?? "");
          if (txt) blocks.push(`${"#".repeat(lvl)} ${txt}`);
          break;
        }
        case "p": {
          const txt = clean(child.textContent ?? "");
          if (txt) blocks.push(txt);
          break;
        }
        case "ul":
        case "ol": {
          const ordered = tag === "ol";
          const items = Array.from(child.querySelectorAll(":scope > li"))
            .map((li, i) => {
              const txt = clean(li.textContent ?? "");
              return txt ? (ordered ? `${i + 1}. ${txt}` : `- ${txt}`) : "";
            })
            .filter(Boolean);
          if (items.length) blocks.push(items.join("\n"));
          break;
        }
        case "blockquote": {
          const txt = clean(child.textContent ?? "");
          if (txt) blocks.push(`> ${txt}`);
          break;
        }
        case "pre": {
          const code = (child.textContent ?? "").replace(/\s+$/, "");
          if (code.trim()) blocks.push("```\n" + code + "\n```");
          break;
        }
        case "hr":
          blocks.push("---");
          break;
        case "figure":
        case "figcaption": {
          const txt = clean(child.textContent ?? "");
          if (txt) blocks.push(txt);
          break;
        }
        case "div":
        case "section":
        case "article":
        case "main": {
          // 容器：若自身直含文字而无块级子元素，作为一段；否则递归。
          const hasBlockChild = child.querySelector(
            "p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,figure,section,article,div",
          );
          if (hasBlockChild) {
            walk(child);
          } else {
            const txt = clean(child.textContent ?? "");
            if (txt) blocks.push(txt);
          }
          break;
        }
        default: {
          // 其余标签：有文字就当一段，保证不丢内容。
          const txt = clean(child.textContent ?? "");
          if (txt) blocks.push(txt);
        }
      }
    }
  };

  walk(container);
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
