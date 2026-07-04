import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { handle, ok } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { mmss } from "@/lib/format";

export const dynamic = "force-dynamic";

// 与 /api/notes/export 的 INCLUDE 对齐：同一套关联字段（课程/课节/标签）。
const INCLUDE = {
  course: { select: { title: true } },
  lesson: { select: { title: true } },
  tags: { include: { tag: { select: { name: true } } } },
} as const;

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

/**
 * 组装一组笔记为 Markdown 文本。
 * 格式与 /api/notes/export 的 buildMarkdown 保持一致（按课程分组、时间戳、来源、标签、
 * 剪藏引用、截帧图、正文），差别仅在：那边面向文件下载（返回 NextResponse 附件），
 * 这里把同一份 markdown 文本装进 {ok,data} 信封回给 iOS。
 */
function buildMarkdown(notes: ExportNote[], header: string): string {
  const STANDALONE_KEY = "__standalone__";
  const byCourse = new Map<string, { title: string; items: ExportNote[] }>();
  for (const n of notes) {
    const key = n.course?.title ? `c:${n.course.title}` : STANDALONE_KEY;
    const title = n.course?.title ?? "未分类笔记";
    const g = byCourse.get(key) ?? { title, items: [] };
    g.items.push(n);
    byCourse.set(key, g);
  }

  const lines: string[] = [header, ""];
  for (const { title, items } of byCourse.values()) {
    if (byCourse.size > 1 || byCourse.has(`c:${title}`)) {
      lines.push(`## ${title}`, "");
    }
    for (const n of items) {
      const stamp = n.timestampSec != null ? ` \`${mmss(n.timestampSec)}\`` : "";
      const heading = n.title?.trim() || n.lesson?.title || "随手记";
      lines.push(`### ${heading}${stamp}`, "");
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
        lines.push(`![截帧](${n.captureUrl})`, "");
      }
      if (n.contentMd?.trim()) {
        lines.push(n.contentMd.trim(), "");
      }
      lines.push("---", "");
    }
  }
  return lines.join("\n");
}

/**
 * GET /api/account/export
 * iOS 设置页导出笔记：与 /api/notes/export 不同，本路由返回统一 {ok,data} 信封
 * （iOS 信封解码器可直接解），而非文件流。data = { count, text, format:"markdown" }，
 * iOS 拿去展示 / 分享 / 落地为文件。对齐 iOS 的 ExportResult{count,text}（format 为附加字段，可忽略）。
 * 越权铁律：强制 where userId，只聚合本人未删除笔记。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    assertRateLimit(req, "account_export", 12, 60_000);

    // 与 notes/export 全量导出一致的上限保护：超出仅取最早 MAX_EXPORT 篇。
    const MAX_EXPORT = 1000;
    const rows = await prisma.note.findMany({
      where: { userId: user.id, deletedAt: null }, // 越权铁律：仅本人笔记
      include: INCLUDE,
      orderBy: [{ courseId: "asc" }, { createdAt: "asc" }],
      take: MAX_EXPORT + 1,
    });
    const truncated = rows.length > MAX_EXPORT;
    const notes = truncated ? rows.slice(0, MAX_EXPORT) : rows;

    const stamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    let header = `# 我的潮汐笔记\n\n> 导出时间：${stamp} · 共 ${notes.length} 篇`;
    if (truncated) {
      header += `\n>\n> ⚠️ 笔记数量超过单次导出上限（${MAX_EXPORT} 篇），本次仅导出最早的 ${MAX_EXPORT} 篇。`;
    }
    const text = buildMarkdown(notes, header);

    await track({
      eventName: "note_export",
      userId: user.id,
      properties: { format: "markdown", count: notes.length, truncated, scope: "account" },
    });

    return ok({ count: notes.length, text, format: "markdown" });
  });
}
