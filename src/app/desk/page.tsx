import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { User } from "@prisma/client";
import { listUpdates, formatDuration, relativeTime } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { shanghaiDayKey } from "@/lib/week";
import { getWeeklyReport } from "@/lib/weekly-report";
import { getShelfCount } from "@/lib/shelf";
import { TidalReveal as Reveal } from "@/components/motion";
import { TrackView } from "@/components/TrackView";
import { StudyDesk, type DeskResume, type DeskNote } from "@/components/StudyDesk";

export const metadata = { title: "书桌" };

/**
 * /desk · 自习桌 —— 登录用户的「家」。
 * v2.2：书桌从首页独立成路由。未登录访问 → 去登录（回跳 /desk）。
 * 所有派生数据服务端计算（SSR 稳定），一律 where userId 强制隔离（越权铁律）。
 */
export default async function DeskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/desk");
  return <StudyDeskHome user={user} />;
}

async function StudyDeskHome({ user }: { user: User }) {
  const userId = user.id; // 越权铁律：所有查询强制 where userId

  const today = shanghaiDayKey();
  const now = new Date();

  const [
    streak,
    streakDayToday,
    resumeRows,
    myCourseCount,
    recentNoteRows,
    dueReviewCount,
    weeklyReport,
    shelfCount,
  ] = await Promise.all([
      // 连续天数
      prisma.streak.findUnique({ where: { userId } }),
      // 今天是否已点亮（当日有学习分钟即算点亮）
      prisma.streakDay.findUnique({ where: { userId_day: { userId, day: today } } }),
      // 断点续学：最近 3 条学习进度（§2 学习中区块）
      prisma.learningProgress.findMany({
        where: { userId },
        orderBy: { lastPlayedAt: "desc" },
        take: 3,
        include: {
          course: { select: { slug: true, title: true, totalDurationSec: true } },
          lesson: { select: { id: true, title: true, durationSec: true } },
        },
      }),
      // 我的课数量（AI 造课 / 导入课，归属当前用户）
      prisma.course.count({
        where: { authorUserId: userId, origin: { in: ["ai_generated", "user_imported"] } },
      }),
      // 最近笔记 3 条
      prisma.note.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 3,
        include: { course: { select: { slug: true } }, lesson: { select: { id: true } } },
      }),
      // 待复习卡数（到期）
      prisma.reviewCard.count({ where: { userId, dueAt: { lte: now } } }),
      // 本周周报（近两周潮汐日历 + 完课数派生，vs 上周对比）
      getWeeklyReport(userId),
      // 书架藏书总册数（书桌书架入口角标；书架明细由弹层打开时按需拉 /api/shelf）
      getShelfCount(userId),
    ]);

  // —— 派生：问候 + 今日状态 ——
  const hours = now.getHours();
  const greeting = hours < 12 ? "上午好" : hours < 18 ? "下午好" : "晚上好";
  const streakCount = streak?.currentStreak ?? 0;
  const litToday = (streakDayToday?.minutes ?? 0) > 0;

  // —— 派生：学习中（最多 3 门，精确断点续学）——
  const resumeList: DeskResume[] = resumeRows
    .filter((p) => p.course && p.lesson)
    .map((p) => {
      const lessonDur = p.lesson!.durationSec || 0;
      const pct = lessonDur > 0 ? Math.min(100, Math.round((p.progressSec / lessonDur) * 100)) : 0;
      const remainSec = Math.max(0, lessonDur - p.progressSec);
      return {
        courseSlug: p.course!.slug,
        lessonId: p.lesson!.id,
        courseTitle: p.course!.title,
        lessonTitle: p.lesson!.title,
        progressPct: pct,
        remainText: remainSec > 0 ? `剩 ${formatDuration(remainSec)}` : "本节已看完",
        resumeSec: p.progressSec,
      };
    });
  const resume = resumeList[0] ?? null;

  // —— 派生：最近笔记 ——
  const recentNotes: DeskNote[] = recentNoteRows.map((n) => ({
    id: n.id,
    courseSlug: n.course?.slug ?? "",
    lessonId: n.lesson?.id ?? "",
    title: n.title?.trim() || n.contentMd.slice(0, 24) || "未命名笔记",
    relativeTime: relativeTime(n.createdAt),
  }));

  // —— 派生：AI 今日建议（静态智能文案，基于 streak/进度/复习派生，不调 LLM）——
  const advice = buildAdvice({
    litToday,
    streakCount,
    resumeTitle: resume?.courseTitle ?? null,
    dueReviewCount,
    myCourseCount,
  });

  // —— 自习室在线人数（静态数，按当日稳定伪随机，避免 hydration 抖动）——
  const onlineCount = deriveOnlineCount(today);

  // 进入专注：有续学则回到该课，否则去个人页
  const focusHref = resume ? `/courses/${resume.courseSlug}/learn/${resume.lessonId}` : "/me";

  return (
    <>
      <TrackView event="desk_view" properties={{ mode: "desk" }} />
      {/* StudyDesk 用 useSearchParams 读 ?shelf=1（自动开书架），Next 15 要求 Suspense 边界。 */}
      <Suspense fallback={null}>
        <StudyDesk
          nickname={user.nickname}
          greeting={greeting}
          streak={streakCount}
          litToday={litToday}
          resume={resume}
          resumeList={resumeList}
          myCourseCount={myCourseCount}
          recentNotes={recentNotes}
          dueReviewCount={dueReviewCount}
          advice={advice}
          onlineCount={onlineCount}
          focusHref={focusHref}
          weeklyReport={weeklyReport}
          shelfCount={shelfCount}
        />
      </Suspense>
      {/* 底部：书架上新（降权展示，复用 listUpdates）*/}
      <ShelfNew />
    </>
  );
}

/** AI 今日建议文案：纯规则派生，读起来像智能助手，SSR 稳定。 */
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

/** 在线人数：按「当日」派生一个稳定的四位数（1,2xx 量级），保证 SSR/hydration 一致。 */
function deriveOnlineCount(dayKey: string): number {
  let h = 0;
  for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) >>> 0;
  return 1180 + (h % 140); // 1180–1319
}

/* 底部一小节「书架上新」——降权展示最新更新日志 */
async function ShelfNew() {
  const updates = await listUpdates(4);
  if (updates.length === 0) return null;
  return (
    <Reveal>
      <section className="mx-auto mt-12 max-w-[960px] md:mt-14">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-[16px] font-bold text-[var(--ink)]">书架上新</h2>
          <Link
            href="/courses?sort=newest"
            className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--red)]"
          >
            全部
            <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {updates.map((u) => (
            <Link
              key={u.id}
              href={`/courses/${u.courseSlug}`}
              className="studio-lift flex flex-col rounded-[13px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card)]"
            >
              <span className="self-start rounded-full bg-[var(--new-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--new-ink)]">
                上新
              </span>
              <p className="mt-2.5 line-clamp-2 text-[13px] font-semibold text-[var(--ink)]">{u.title}</p>
              <p className="mono mt-auto pt-2.5 text-[11px] text-[var(--ink4)]">
                {u.courseTitle} · {u.relativeTime}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
