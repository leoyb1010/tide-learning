import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, handle } from "@/lib/api";
import { listUpdates, formatDuration, relativeTime } from "@/lib/queries";
import { shanghaiDayKey } from "@/lib/week";

export const dynamic = "force-dynamic";

/**
 * GET /api/desk — 聚合书桌接口（iOS 书桌一次拉齐，减少多次往返）。
 * 与 /desk 页面 StudyDeskHome 的服务端查询对齐，所有查询强制 where userId（越权铁律）。
 * 派生文案（问候/建议）纯规则计算，不调 LLM，SSR/客户端一致。
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const userId = user.id; // 越权铁律：所有查询强制 where userId

    const today = shanghaiDayKey();
    const now = new Date();

    const [streak, streakDayToday, resumeRows, myCourseCount, recentNoteRows, dueReviewCount, updates] =
      await Promise.all([
        prisma.streak.findUnique({ where: { userId } }),
        prisma.streakDay.findUnique({ where: { userId_day: { userId, day: today } } }),
        prisma.learningProgress.findMany({
          where: { userId },
          orderBy: { lastPlayedAt: "desc" },
          take: 3,
          include: {
            course: { select: { slug: true, title: true } },
            lesson: { select: { id: true, title: true, durationSec: true } },
          },
        }),
        prisma.course.count({
          where: { authorUserId: userId, origin: { in: ["ai_generated", "user_imported"] } },
        }),
        prisma.note.findMany({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 3,
        }),
        prisma.reviewCard.count({ where: { userId, dueAt: { lte: now } } }),
        listUpdates(4),
      ]);

    // —— 派生：问候（按服务器时间） + 今日状态 ——
    const hours = now.getHours();
    const greeting = hours < 12 ? "上午好" : hours < 18 ? "下午好" : "晚上好";
    const streakCount = streak?.currentStreak ?? 0;
    const litToday = (streakDayToday?.minutes ?? 0) > 0;

    // —— 派生：学习中（最多 3 门，精确断点续学）——
    const resumeList = resumeRows
      .filter((p) => p.course && p.lesson)
      .map((p) => {
        const lessonDur = p.lesson!.durationSec || 0;
        const pct = lessonDur > 0 ? Math.min(100, Math.round((p.progressSec / lessonDur) * 100)) : 0;
        const remainSec = Math.max(0, lessonDur - p.progressSec);
        return {
          courseSlug: p.course!.slug,
          courseTitle: p.course!.title,
          lessonId: p.lesson!.id,
          lessonTitle: p.lesson!.title,
          progressPct: pct,
          remainText: remainSec > 0 ? `剩 ${formatDuration(remainSec)}` : "本节已看完",
        };
      });
    const resume = resumeList[0] ?? null;

    // —— 派生：最近笔记 3 条 ——
    const recentNotes = recentNoteRows.map((n) => ({
      id: n.id,
      title: n.title?.trim() || n.contentMd.slice(0, 24) || "未命名笔记",
      relativeTime: relativeTime(n.createdAt),
    }));

    // —— 派生：AI 今日建议（纯规则派生，复用 desk 页面 buildAdvice 逻辑）——
    const advice = buildAdvice({
      litToday,
      streakCount,
      resumeTitle: resume?.courseTitle ?? null,
      dueReviewCount,
      myCourseCount,
    });

    return ok({
      greeting,
      nickname: user.nickname,
      streak: streakCount,
      litToday,
      resumeList,
      myCourseCount,
      recentNotes,
      dueReviewCount,
      advice,
      updates,
    });
  });
}

/** AI 今日建议文案：纯规则派生，读起来像智能助手（复用 /desk 页面逻辑）。 */
function buildAdvice(o: {
  litToday: boolean;
  streakCount: number;
  resumeTitle: string | null;
  dueReviewCount: number;
  myCourseCount: number;
}): string {
  const parts: string[] = [];
  if (o.resumeTitle) {
    parts.push(`继续《${o.resumeTitle}》`);
  } else if (o.myCourseCount > 0) {
    parts.push("挑一门你的课接着学");
  } else {
    parts.push("说出你想学的，先造一门课");
  }
  if (o.dueReviewCount > 0) parts.push(`复习 ${o.dueReviewCount} 张卡`);
  const body = parts.join("，");
  if (!o.litToday) return `今天还没点亮。${body}，10 分钟就够。`;
  if (o.streakCount >= 3) return `连续 ${o.streakCount} 天，状态在线。${body}，保持节奏。`;
  return `今天已点亮，${body}。`;
}
