import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { handle, fail } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { mmss } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/notes/export?format=md — 将全部笔记打包为 Markdown 文本下载。
 * 含课程/章节归档、时间戳、截帧图引用、剪藏原文。附件形式返回。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    assertRateLimit(req, "note_export", 6, 60_000);

    const format = req.nextUrl.searchParams.get("format") ?? "md";
    if (format !== "md") return fail("暂不支持该导出格式");

    const notes = await prisma.note.findMany({
      where: { userId: user.id, deletedAt: null },
      include: {
        course: { select: { title: true } },
        lesson: { select: { title: true } },
        tags: { include: { tag: { select: { name: true } } } },
      },
      orderBy: [{ courseId: "asc" }, { createdAt: "asc" }],
    });

    // 按课程分组拼装 Markdown
    const byCourse = new Map<string, { title: string; items: typeof notes }>();
    for (const n of notes) {
      const g = byCourse.get(n.courseId) ?? { title: n.course.title, items: [] };
      g.items.push(n);
      byCourse.set(n.courseId, g);
    }

    const lines: string[] = [];
    lines.push(`# 我的潮汐笔记`);
    lines.push("");
    lines.push(`> 导出时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 共 ${notes.length} 篇`);
    lines.push("");

    for (const { title, items } of byCourse.values()) {
      lines.push(`## ${title}`);
      lines.push("");
      for (const n of items) {
        const stamp = n.timestampSec != null ? ` \`${mmss(n.timestampSec)}\`` : "";
        const kindTag = n.kind === "capture" ? " 📸" : n.kind === "clip" ? " ✂️" : "";
        const heading = n.title?.trim() || n.lesson.title;
        lines.push(`### ${heading}${stamp}${kindTag}`);
        lines.push("");
        lines.push(`_${n.lesson.title}_`);
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

    const md = lines.join("\n");
    await track({ eventName: "note_export", userId: user.id, properties: { format, count: notes.length } });

    const filename = `tide-notes-${new Date().toISOString().slice(0, 10)}.md`;
    return new NextResponse(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
