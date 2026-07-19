import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { handle, fail } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { mmss } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

// HTML 转义：拼装单文件 HTML 时对标题/元信息等纯文本片段做转义，避免注入破坏结构。
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ExportNote = {
  id: string;
  title: string | null;
  contentMd: string;
  kind: string;
  source: string;
  sourceText: string | null;
  sourceUrl: string | null;
  captureUrl: string | null;
  timestampSec: number | null;
  anchorRef: string | null;
  notebookId: string | null;
  courseId: string | null;
  lessonId: string | null;
  createdAt: Date;
  updatedAt: Date;
  course: { title: string } | null;
  lesson: { title: string } | null;
  tags: { tag: { name: string } }[];
};

/** 组装一组笔记为 Markdown 文本。standalone=true 时不打「未我的潮汐笔记」总标题。 */
function buildMarkdown(notes: ExportNote[], opts: { header: string; truncatedNote?: string }): string {
  const STANDALONE_KEY = "__standalone__";
  const byCourse = new Map<string, { title: string; items: ExportNote[] }>();
  for (const n of notes) {
    const key = n.course?.title ? `c:${n.course.title}` : STANDALONE_KEY;
    const title = n.course?.title ?? "未分类笔记";
    const g = byCourse.get(key) ?? { title, items: [] };
    g.items.push(n);
    byCourse.set(key, g);
  }

  const lines: string[] = [];
  lines.push(opts.header);
  lines.push("");
  if (opts.truncatedNote) {
    lines.push(`> ⚠️ ${opts.truncatedNote}`);
    lines.push("");
  }

  for (const { title, items } of byCourse.values()) {
    if (byCourse.size > 1 || byCourse.has(`c:${title}`)) {
      lines.push(`## ${title}`);
      lines.push("");
    }
    for (const n of items) {
      const stamp = n.timestampSec != null ? ` \`${mmss(n.timestampSec)}\`` : "";
      const heading = n.title?.trim() || n.lesson?.title || "随手记";
      lines.push(`### ${heading}${stamp}`);
      lines.push("");
      if (n.lesson?.title) lines.push(`_${n.lesson.title}_`);
      if (n.sourceUrl) lines.push(`来源：${n.sourceUrl}`);
      const tagNames = n.tags.map((t) => `#${t.tag.name}`).join(" ");
      if (tagNames) lines.push(tagNames);
      lines.push("");
      if (n.kind === "clip" && n.sourceText?.trim()) {
        for (const seg of n.sourceText.split("\n")) lines.push(`> ${seg}`);
        lines.push("");
      }
      if (n.kind === "capture" && n.captureUrl) {
        lines.push(`![截帧](${n.captureUrl})`);
        lines.push("");
      }
      if (n.contentMd?.trim()) {
        lines.push(n.contentMd.trim());
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** 组装一组笔记为带样式单文件 HTML（STUDIO token 内联为等价色，可离线打开）。 */
function buildHtml(notes: ExportNote[], opts: { pageTitle: string; subtitle: string; truncatedNote?: string }): string {
  const sections: string[] = [];
  for (const n of notes) {
    const heading = esc(n.title?.trim() || n.lesson?.title || "随手记");
    const stamp = n.timestampSec != null ? `<span class="mono stamp">${esc(mmss(n.timestampSec))}</span>` : "";
    const meta: string[] = [];
    if (n.course?.title) meta.push(esc(n.course.title));
    if (n.lesson?.title) meta.push(esc(n.lesson.title));
    meta.push(new Date(n.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
    const tags = n.tags.map((t) => `<span class="tag">#${esc(t.tag.name)}</span>`).join("");
    const src = n.sourceUrl
      ? `<p class="src">来源：<a href="${esc(n.sourceUrl)}" rel="noreferrer noopener">${esc(n.sourceUrl)}</a></p>`
      : "";
    const clip =
      n.kind === "clip" && n.sourceText?.trim()
        ? `<blockquote>${esc(n.sourceText).replace(/\n/g, "<br>")}</blockquote>`
        : "";
    const capture =
      n.kind === "capture" && n.captureUrl
        ? `<img class="capture" src="${esc(n.captureUrl)}" alt="截帧">`
        : "";
    // 正文走既有 markdown 渲染器（已做转义/白名单），可安全内联
    const body = n.contentMd?.trim() ? `<div class="body">${renderMarkdown(n.contentMd)}</div>` : "";
    sections.push(
      `<article>
  <h2>${heading} ${stamp}</h2>
  <p class="meta">${meta.join(" · ")}</p>
  ${tags ? `<p class="tags">${tags}</p>` : ""}
  ${src}
  ${clip}
  ${capture}
  ${body}
</article>`,
    );
  }

  const warn = opts.truncatedNote ? `<p class="warn">⚠️ ${esc(opts.truncatedNote)}</p>` : "";
  // 亮暗跟随：用 prefers-color-scheme 切换等价 token 值（导出件独立于站点 CSS，故内联）
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.pageTitle)}</title>
<style>
.hs{margin-left:.12em} /* heti CJK-拉丁间距标注(renderMarkdown 产物) */
:root{
  --surface:#ffffff;--surface2:#f7f7f5;--surface-inset:#f0efec;
  --ink:#1a1a1a;--ink2:#454545;--ink3:#6b6b6b;--ink4:#9a9a9a;
  --border:#e6e4e0;--border2:#d6d4cf;--red:#d6482e;--red-soft:#fbeae6;
}
@media (prefers-color-scheme:dark){
  :root{
    --surface:#181818;--surface2:#1f1f1f;--surface-inset:#242424;
    --ink:#f2f2f0;--ink2:#c8c8c5;--ink3:#9a9a97;--ink4:#6f6f6c;
    --border:#2c2c2c;--border2:#3a3a3a;--red:#ff6a4d;--red-soft:#2a1a16;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--surface2);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  line-height:1.75;-webkit-font-smoothing:antialiased}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px 80px}
header{margin-bottom:32px}
header .kicker{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink4)}
header h1{font-size:28px;margin:8px 0 6px;font-weight:700}
header .sub{color:var(--ink3);font-size:14px}
.warn{background:var(--red-soft);color:var(--red);border-radius:12px;
  padding:10px 14px;font-size:13px;margin:16px 0}
article{background:var(--surface);border:1px solid var(--border);border-radius:16px;
  padding:24px 26px;margin-bottom:20px}
article h2{font-size:20px;margin:0 0 8px;font-weight:700;color:var(--ink)}
.stamp{font-size:13px;color:var(--ink4);margin-left:6px}
.meta{color:var(--ink4);font-size:12px;margin:0 0 10px}
.tags{margin:0 0 12px}
.tag{display:inline-block;background:var(--surface-inset);color:var(--ink3);
  border-radius:999px;padding:2px 10px;font-size:12px;margin-right:6px}
.src{font-size:12px;color:var(--ink3);margin:0 0 12px;word-break:break-all}
.src a{color:var(--red);text-decoration:none}
blockquote{border-left:3px solid var(--border2);background:var(--surface-inset);
  margin:0 0 14px;padding:10px 16px;border-radius:0 12px 12px 0;color:var(--ink2);
  font-style:italic;font-size:14px}
.capture{max-width:100%;border-radius:12px;border:1px solid var(--border);margin:0 0 14px}
.body{font-size:15px;color:var(--ink)}
.body img{max-width:100%;border-radius:10px}
.body pre{background:var(--surface-inset);padding:14px;border-radius:10px;overflow:auto}
.body code{font-family:ui-monospace,monospace;font-size:.9em}
.body a{color:var(--red)}
.body h1,.body h2,.body h3{font-weight:700}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="kicker">TIDE · 笔记导出</div>
  <h1>${esc(opts.pageTitle)}</h1>
  <p class="sub">${esc(opts.subtitle)}</p>
</header>
${warn}
${sections.join("\n")}
</div>
</body>
</html>`;
}

/** 去 Markdown 语法，得到可读纯文本行（用于 .txt 导出）。仅做常见语法剥离，够读即可。 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^```.*$/gm, "") // 代码围栏行
    .replace(/`([^`]+)`/g, "$1") // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1（$2）") // 链接 → 文字（网址）
    .replace(/^#{1,6}\s+/gm, "") // 标题井号
    .replace(/^\s{0,3}>\s?/gm, "") // 引用前缀
    .replace(/^\s*[-*+]\s+/gm, "· ") // 无序列表 → 中点
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // 粗体
    .replace(/(\*|_)(.*?)\1/g, "$2") // 斜体
    .replace(/\n{3,}/g, "\n\n") // 收敛多空行
    .trim();
}

/** 组装一组笔记为去语法的可读纯文本（.txt）。 */
function buildText(notes: ExportNote[], opts: { header: string; truncatedNote?: string }): string {
  const lines: string[] = [opts.header, ""];
  if (opts.truncatedNote) {
    lines.push(`⚠️ ${opts.truncatedNote}`, "");
  }
  for (const n of notes) {
    const heading = n.title?.trim() || n.lesson?.title || "随手记";
    const stamp = n.timestampSec != null ? ` [${mmss(n.timestampSec)}]` : "";
    lines.push(`【${heading}】${stamp}`);
    // 知识脉络：来源（课程/AI/手记）> 归属（笔记本/课节）> 内容
    const meta: string[] = [];
    if (n.course?.title) meta.push(`来自《${n.course.title}》`);
    if (n.lesson?.title) meta.push(n.lesson.title);
    meta.push(new Date(n.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
    lines.push(meta.join(" · "));
    if (n.sourceUrl) lines.push(`来源：${n.sourceUrl}`);
    const tagNames = n.tags.map((t) => `#${t.tag.name}`).join(" ");
    if (tagNames) lines.push(tagNames);
    lines.push("");
    if (n.kind === "clip" && n.sourceText?.trim()) {
      for (const seg of n.sourceText.split("\n")) lines.push(`  “${seg}”`);
      lines.push("");
    }
    if (n.contentMd?.trim()) {
      lines.push(stripMarkdown(n.contentMd));
      lines.push("");
    }
    lines.push("· · · · · · · · · ·", "");
  }
  return lines.join("\n");
}

/**
 * 组装一组笔记为结构化 JSON（.json）。
 * 含知识脉络全字段：notebookId/courseId/lessonId/anchorRef/source/timestampSec/createdAt/updatedAt，
 * 供迁移 / 再导入使用（未来导入端可按 schemaVersion 兼容处理）。
 */
function buildJson(notes: ExportNote[], meta: { scope: "single" | "all"; truncated?: boolean }): string {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scope: meta.scope,
    truncated: meta.truncated ?? false,
    count: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      contentMd: n.contentMd,
      kind: n.kind,
      source: n.source,
      sourceText: n.sourceText,
      sourceUrl: n.sourceUrl,
      captureUrl: n.captureUrl,
      timestampSec: n.timestampSec,
      anchorRef: n.anchorRef,
      notebookId: n.notebookId,
      courseId: n.courseId,
      lessonId: n.lessonId,
      courseTitle: n.course?.title ?? null,
      lessonTitle: n.lesson?.title ?? null,
      tags: n.tags.map((t) => t.tag.name),
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 组装一组笔记为「打印友好」单文件 HTML（.html，用户在浏览器 Cmd/Ctrl+P → 另存为 PDF）。
 * 零依赖 PDF 方案：不引 puppeteer/pdfkit 等重型库，改用带 @media print 优化的自包含 HTML —
 * 屏幕上有一条「按 Cmd/Ctrl+P 存 PDF」提示条（打印时用 .no-print 隐藏），
 * 打印样式去背景色、避免卡片被跨页切断（break-inside:avoid）、正文用适合纸张的字号行距。
 */
function buildPrintHtml(notes: ExportNote[], opts: { pageTitle: string; subtitle: string; truncatedNote?: string }): string {
  const sections: string[] = [];
  for (const n of notes) {
    const heading = esc(n.title?.trim() || n.lesson?.title || "随手记");
    const stamp = n.timestampSec != null ? `<span class="stamp">${esc(mmss(n.timestampSec))}</span>` : "";
    // 知识脉络：来源 > 归属 > 内容
    const lineage: string[] = [];
    if (n.course?.title) lineage.push(`来自《${esc(n.course.title)}》`);
    if (n.lesson?.title) lineage.push(esc(n.lesson.title));
    lineage.push(new Date(n.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));
    const tags = n.tags.map((t) => `<span class="tag">#${esc(t.tag.name)}</span>`).join("");
    const src = n.sourceUrl
      ? `<p class="src">来源：${esc(n.sourceUrl)}</p>`
      : "";
    const clip =
      n.kind === "clip" && n.sourceText?.trim()
        ? `<blockquote>${esc(n.sourceText).replace(/\n/g, "<br>")}</blockquote>`
        : "";
    const capture =
      n.kind === "capture" && n.captureUrl
        ? `<img class="capture" src="${esc(n.captureUrl)}" alt="截帧">`
        : "";
    const body = n.contentMd?.trim() ? `<div class="body">${renderMarkdown(n.contentMd)}</div>` : "";
    sections.push(
      `<article>
  <h2>${heading} ${stamp}</h2>
  <p class="lineage">${lineage.join(" · ")}</p>
  ${tags ? `<p class="tags">${tags}</p>` : ""}
  ${src}
  ${clip}
  ${capture}
  ${body}
</article>`,
    );
  }

  const warn = opts.truncatedNote ? `<p class="warn no-print">⚠️ ${esc(opts.truncatedNote)}</p>` : "";
  // 打印版：屏幕上用中性纸感底色 + 提示条；打印时切白底、避免卡片跨页切断。
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.pageTitle)}</title>
<style>
.hs{margin-left:.12em} /* heti CJK-拉丁间距标注(renderMarkdown 产物) */
*{box-sizing:border-box}
body{margin:0;background:#f4f3f0;color:#1a1a1a;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  line-height:1.8;-webkit-font-smoothing:antialiased}
.hint{position:sticky;top:0;z-index:1;background:#1a1a1a;color:#fff;
  padding:12px 20px;font-size:13px;text-align:center;letter-spacing:.01em}
.hint kbd{background:#333;border:1px solid #555;border-radius:5px;padding:1px 7px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.wrap{max-width:760px;margin:0 auto;padding:36px 24px 80px}
header{margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #1a1a1a}
header .kicker{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:#9a9a9a}
header h1{font-size:26px;margin:8px 0 6px;font-weight:700}
header .sub{color:#6b6b6b;font-size:14px}
.warn{background:#fbeae6;color:#c8000f;border-radius:8px;padding:10px 14px;font-size:13px;margin:16px 0}
article{background:#fff;border:1px solid #e6e4e0;border-radius:14px;
  padding:22px 24px;margin-bottom:18px;break-inside:avoid;page-break-inside:avoid}
article h2{font-size:19px;margin:0 0 6px;font-weight:700}
.stamp{font-size:13px;color:#9a9a9a;margin-left:6px;font-family:ui-monospace,monospace}
.lineage{color:#6b6b6b;font-size:12px;margin:0 0 10px}
.tags{margin:0 0 12px}
.tag{display:inline-block;background:#f0efec;color:#6b6b6b;border-radius:999px;
  padding:2px 10px;font-size:12px;margin-right:6px}
.src{font-size:12px;color:#6b6b6b;margin:0 0 12px;word-break:break-all}
blockquote{border-left:3px solid #d6d4cf;background:#f7f7f5;margin:0 0 14px;
  padding:10px 16px;border-radius:0 10px 10px 0;color:#454545;font-style:italic;font-size:14px}
.capture{max-width:100%;border-radius:10px;border:1px solid #e6e4e0;margin:0 0 14px}
.body{font-size:15px}
.body img{max-width:100%;border-radius:8px}
.body pre{background:#f0efec;padding:14px;border-radius:8px;overflow:auto}
.body code{font-family:ui-monospace,monospace;font-size:.9em}
.body h1,.body h2,.body h3{font-weight:700}
@media print{
  /* 打印：去屏幕底色/提示条，卡片扁平化避免油墨浪费与跨页切断 */
  .no-print,.hint{display:none !important}
  body{background:#fff}
  .wrap{max-width:none;padding:0}
  article{border:none;border-bottom:1px solid #ccc;border-radius:0;padding:14px 0;margin-bottom:0}
  blockquote,.tag,.body pre{background:transparent}
  @page{margin:16mm}
}
</style>
</head>
<body>
<div class="hint no-print">这是打印友好版 · 按 <kbd>Cmd/Ctrl + P</kbd> → 目标选「另存为 PDF」即可导出 PDF</div>
<div class="wrap">
<header>
  <div class="kicker">TIDE · 笔记打印版</div>
  <h1>${esc(opts.pageTitle)}</h1>
  <p class="sub">${esc(opts.subtitle)}</p>
</header>
${warn}
${sections.join("\n")}
</div>
</body>
</html>`;
}

const INCLUDE = {
  course: { select: { title: true } },
  lesson: { select: { title: true } },
  tags: { include: { tag: { select: { name: true } } } },
} as const;

// 导出格式白名单：扩展名 + Content-Type（单一真相源，新增格式只改这里）。
// print 复用 .html 扩展名（本质就是一份为打印优化的 HTML，用户浏览器 Cmd/Ctrl+P 存 PDF）。
const FORMATS = {
  md: { ext: "md", type: "text/markdown; charset=utf-8" },
  html: { ext: "html", type: "text/html; charset=utf-8" },
  txt: { ext: "txt", type: "text/plain; charset=utf-8" },
  json: { ext: "json", type: "application/json; charset=utf-8" },
  print: { ext: "html", type: "text/html; charset=utf-8" },
} as const;
type ExportFormat = keyof typeof FORMATS;

function isFormat(f: string): f is ExportFormat {
  return f in FORMATS;
}

/**
 * GET /api/notes/export
 *   ?format=md|html|txt|json|print   导出格式：
 *     md   = 纯 Markdown 附件
 *     html = 带样式单文件网页（亮暗跟随）
 *     txt  = 去 Markdown 语法的可读纯文本
 *     json = 结构化全字段（含知识脉络 notebookId/courseId/lessonId/anchorRef/source/时间），供再导入/迁移
 *     print= 打印友好单文件 HTML（浏览器 Cmd/Ctrl+P 另存 PDF，零 PDF 依赖）
 *   ?noteId=<id>         仅导出单条笔记（越权 where userId 兜底，找不到 404）
 *   ?notebookId=<id>     仅导出某笔记本内的笔记（同样强制 where userId，越权返回空集）
 * 全量导出仍受 MAX_EXPORT 上限保护，超出时头部提示截断。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    assertRateLimit(req, "note_export", 12, 60_000);

    const format = req.nextUrl.searchParams.get("format") ?? "md";
    if (!isFormat(format)) return fail("暂不支持该导出格式");
    const noteId = req.nextUrl.searchParams.get("noteId")?.trim();
    const notebookId = req.nextUrl.searchParams.get("notebookId")?.trim();

    const dateSlug = new Date().toISOString().slice(0, 10);
    const { ext, type: contentType } = FORMATS[format];

    // —— 单条导出 ——
    if (noteId) {
      const n = await prisma.note.findFirst({
        where: { id: noteId, userId: user.id, deletedAt: null },
        include: INCLUDE,
      });
      if (!n) return fail("笔记不存在", 404);

      const heading = n.title?.trim() || n.lesson?.title || "随手记";
      const subtitle = `导出于 ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
      let body: string;
      switch (format) {
        case "html":
          body = buildHtml([n], { pageTitle: heading, subtitle });
          break;
        case "print":
          body = buildPrintHtml([n], { pageTitle: heading, subtitle });
          break;
        case "txt":
          body = buildText([n], { header: heading });
          break;
        case "json":
          body = buildJson([n], { scope: "single" });
          break;
        default:
          body = buildMarkdown([n], { header: `# ${heading}` });
      }

      await track({ eventName: "note_export", userId: user.id, properties: { format, scope: "single" } });
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="tide-note-${dateSlug}.${ext}"`,
        },
      });
    }

    // —— 全量 / 笔记本范围导出 ——
    // notebookId 时先取本人该笔记本（越权返回 null → 空集，不泄露存在性），拿标题做导出标题。
    let notebookTitle: string | null = null;
    if (notebookId) {
      const nb = await prisma.notebook.findFirst({
        where: { id: notebookId, userId: user.id },
        select: { title: true },
      });
      notebookTitle = nb?.title ?? null;
    }

    const MAX_EXPORT = 1000;
    const rows = await prisma.note.findMany({
      // 强制 where userId；notebookId 存在时再叠加范围（越权笔记本 → 空集）
      where: {
        userId: user.id,
        deletedAt: null,
        ...(notebookId ? { notebookId } : {}),
      },
      include: INCLUDE,
      orderBy: [{ courseId: "asc" }, { createdAt: "asc" }],
      take: MAX_EXPORT + 1,
    });
    const truncated = rows.length > MAX_EXPORT;
    const notes = truncated ? rows.slice(0, MAX_EXPORT) : rows;
    const truncatedNote = truncated
      ? `笔记数量超过单次导出上限（${MAX_EXPORT} 篇），本次仅导出最早的 ${MAX_EXPORT} 篇。`
      : undefined;
    const stamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const pageTitle = notebookId ? notebookTitle?.trim() || "笔记本" : "我的潮汐笔记";
    const subtitle = `导出于 ${stamp} · 共 ${notes.length} 篇`;

    let body: string;
    switch (format) {
      case "html":
        body = buildHtml(notes, { pageTitle, subtitle, truncatedNote });
        break;
      case "print":
        body = buildPrintHtml(notes, { pageTitle, subtitle, truncatedNote });
        break;
      case "txt":
        body = buildText(notes, {
          header: `${pageTitle}\n${subtitle}`,
          truncatedNote,
        });
        break;
      case "json":
        body = buildJson(notes, { scope: "all", truncated });
        break;
      default:
        body = buildMarkdown(notes, {
          header: `# ${pageTitle}\n\n> 导出时间：${stamp} · 共 ${notes.length} 篇`,
          truncatedNote,
        });
    }

    await track({
      eventName: "note_export",
      userId: user.id,
      properties: { format, count: notes.length, truncated, scope: notebookId ? "notebook" : "all" },
    });
    const fileStem = notebookId ? "tide-notebook" : "tide-notes";
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileStem}-${dateSlug}.${ext}"`,
      },
    });
  });
}
