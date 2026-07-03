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
  title: string | null;
  contentMd: string;
  kind: string;
  sourceText: string | null;
  sourceUrl: string | null;
  captureUrl: string | null;
  timestampSec: number | null;
  createdAt: Date;
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

const INCLUDE = {
  course: { select: { title: true } },
  lesson: { select: { title: true } },
  tags: { include: { tag: { select: { name: true } } } },
} as const;

/**
 * GET /api/notes/export
 *   ?format=md|html      导出格式（md=纯 Markdown 附件；html=带样式单文件）
 *   ?noteId=<id>         仅导出单条笔记（越权 where userId 兜底，找不到 404）
 * 全量导出仍受 MAX_EXPORT 上限保护，超出时头部提示截断。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    assertRateLimit(req, "note_export", 12, 60_000);

    const format = req.nextUrl.searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "html") return fail("暂不支持该导出格式");
    const noteId = req.nextUrl.searchParams.get("noteId")?.trim();

    const dateSlug = new Date().toISOString().slice(0, 10);
    const ext = format === "html" ? "html" : "md";
    const contentType =
      format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8";

    // —— 单条导出 ——
    if (noteId) {
      const n = await prisma.note.findFirst({
        where: { id: noteId, userId: user.id, deletedAt: null },
        include: INCLUDE,
      });
      if (!n) return fail("笔记不存在", 404);

      const heading = n.title?.trim() || n.lesson?.title || "随手记";
      const body =
        format === "html"
          ? buildHtml([n], {
              pageTitle: heading,
              subtitle: `导出于 ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
            })
          : buildMarkdown([n], { header: `# ${heading}` });

      await track({ eventName: "note_export", userId: user.id, properties: { format, scope: "single" } });
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="tide-note-${dateSlug}.${ext}"`,
        },
      });
    }

    // —— 全量导出 ——
    const MAX_EXPORT = 1000;
    const rows = await prisma.note.findMany({
      where: { userId: user.id, deletedAt: null },
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

    const body =
      format === "html"
        ? buildHtml(notes, {
            pageTitle: "我的潮汐笔记",
            subtitle: `导出于 ${stamp} · 共 ${notes.length} 篇`,
            truncatedNote,
          })
        : buildMarkdown(notes, {
            header: `# 我的潮汐笔记\n\n> 导出时间：${stamp} · 共 ${notes.length} 篇`,
            truncatedNote,
          });

    await track({ eventName: "note_export", userId: user.id, properties: { format, count: notes.length, truncated } });
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="tide-notes-${dateSlug}.${ext}"`,
      },
    });
  });
}
