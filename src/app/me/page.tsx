import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { getGamificationSummary } from "@/lib/gamification";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/AccountActions";
import { TideCalendar } from "@/components/TideCalendar";
import { formatDurationSec } from "@/lib/format";
import { shanghaiDayKey } from "@/lib/week";

export const metadata = { title: "我的" };

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const [snapshot, progressAgg, notesCount, votesAgg, recent, gamification] = await Promise.all([
    resolveEntitlement(user.id),
    prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.demandVote.aggregate({ where: { userId: user.id }, _sum: { voteCount: true } }),
    prisma.learningProgress.findMany({
      where: { userId: user.id },
      orderBy: { lastPlayedAt: "desc" },
      take: 3,
      include: { course: { select: { slug: true, title: true } }, lesson: { select: { id: true, title: true } } },
    }),
    getGamificationSummary(user.id),
  ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;

  // 本周节奏 / 本周数据：从潮汐日历(近90天)推导，最近 7 天（周一→周日）
  const todayKey = shanghaiDayKey();
  const calByDay = new Map(gamification.calendar.map((d) => [d.day, d]));
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const todayLocalDow = (new Date(ty, tm - 1, td).getDay() + 6) % 7; // 周一=0
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(ty, tm - 1, td - todayLocalDow + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const rec = calByDay.get(key);
    return { minutes: rec?.minutes ?? 0, notes: rec?.notes ?? 0, isFuture: key > todayKey };
  });
  const weekMinutes = weekDays.reduce((s, d) => s + d.minutes, 0);
  const weekNotes = weekDays.reduce((s, d) => s + d.notes, 0);
  const weekActiveDays = weekDays.filter((d) => d.minutes > 0).length;
  const peakMinutes = Math.max(60, ...weekDays.map((d) => d.minutes)); // 柱高基准
  const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

  // 满月徽章：连续 30 天
  const streakGoal = 30;
  const streakPct = Math.min(gamification.currentStreak / streakGoal, 1);
  const daysToGoal = Math.max(streakGoal - gamification.currentStreak, 0);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-5">
      {/* 用户信息 */}
      <section className="studio-rise flex items-center gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xl font-bold text-[var(--surface)]">
          {user.nickname.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold text-[var(--ink)]">{user.nickname}</p>
          <p className="mono text-[12px] text-[var(--ink3)]">{user.email ?? user.phone}</p>
        </div>
        <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red)]">
          {meta.label}
        </span>
      </section>

      {/* 顶部三卡：streak 深色卡 + 本周数据 + 本周节奏柱图 */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* 连续学习（深色卡） */}
        <div className="studio-rise relative overflow-hidden rounded-[18px] bg-[var(--video-bg)] p-5 text-white">
          <div className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--red-soft)] text-[15px]" aria-hidden>
            🔥
          </div>
          <p className="mono text-[10px] uppercase tracking-[0.14em] text-white/45">STREAK</p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="mono text-[52px] font-bold leading-none">{gamification.currentStreak}</span>
            <span className="text-[15px] text-white/60">天</span>
          </div>
          <p className="mt-1 text-[13px] text-white/55">连续学习</p>
          {/* 14 格进度（映射到满月目标进度） */}
          <div className="mt-4 flex gap-1">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i < Math.round(streakPct * 14) ? "bg-[var(--red)]" : "bg-white/12"}`}
              />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-white/50">
            {daysToGoal > 0 ? `再学 ${daysToGoal} 天解锁满月徽章` : "已解锁满月徽章 🌕"}
          </p>
        </div>

        {/* 本周数据 */}
        <div className="studio-rise rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
          <WeekStat label="本周时长" value={formatDurationSec(weekMinutes * 60)} />
          <div className="mx-5 border-t border-[var(--border)]" />
          <WeekStat label="活跃天数" value={`${weekActiveDays} 天`} />
          <div className="mx-5 border-t border-[var(--border)]" />
          <WeekStat label="新增笔记" value={`${weekNotes} 条`} />
        </div>

        {/* 本周节奏柱状图 */}
        <div className="studio-rise flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-bold text-[var(--ink)]">本周学习节奏</h3>
            <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">分钟 · 天</span>
          </div>
          <div className="mt-4 flex flex-1 items-end justify-between gap-2" style={{ minHeight: 108 }}>
            {weekDays.map((d, i) => {
              const h = d.minutes > 0 ? Math.max((d.minutes / peakMinutes) * 100, 8) : 0;
              const isPeak = d.minutes >= peakMinutes;
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-[88px] w-full items-end">
                    <div
                      className={`w-full rounded-t-[4px] transition-colors ${isPeak && d.minutes > 0 ? "bg-[var(--red)]" : d.minutes > 0 ? "bg-[var(--border2)]" : "bg-[var(--surface-inset)]"}`}
                      style={{ height: `${Math.max(h, d.minutes > 0 ? h : 4)}%` }}
                      title={d.isFuture ? undefined : `周${WEEK_LABELS[i]} · ${d.minutes} 分钟`}
                    />
                  </div>
                  <span className="mono text-[10px] text-[var(--ink4)]">{WEEK_LABELS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 学习热力日历（保留 TideCalendar：服务端按 Asia/Shanghai 定基准日，SSR/CSR 一致） */}
      <div className="studio-rise">
        <TideCalendar calendar={gamification.calendar} todayKey={todayKey} />
      </div>

      {/* 成就徽章 */}
      {gamification.achievements.length > 0 && (
        <section className="studio-rise">
          <h2 className="mb-3.5 text-[18px] font-bold text-[var(--ink)]">成就徽章</h2>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {gamification.achievements.map((a) => {
              // 成就 key → 徽章图（缺省回退 emoji/icon 文本）
              const badgeImg: Record<string, string> = {
                week_streak: "/badges/badge-streak.png",
                first_subscribe: "/badges/badge-milestone.png",
                first_note: "/badges/badge-note.png",
                first_tide: "/badges/badge-vote.png",
                cocreator: "/badges/badge-vote.png",
              };
              const img = badgeImg[a.key];
              return (
                <div
                  key={a.key}
                  className="studio-lift flex flex-col items-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 text-center shadow-[var(--card)]"
                >
                  {img ? (
                    <img src={img} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 object-contain" />
                  ) : (
                    <span className="text-[30px] leading-none" aria-hidden>{a.icon || "🌊"}</span>
                  )}
                  <p className="truncate text-[12px] font-semibold text-[var(--ink)]">{a.name}</p>
                  <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--red)]">
                    已获得
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 我的数据（累计/笔记/投票） */}
      <section className="studio-rise grid grid-cols-3 gap-3 sm:gap-4">
        <StatBox value={formatDurationSec(progressAgg._sum.progressSec ?? 0)} label="累计学习" />
        <StatBox value={`${notesCount}`} label="笔记" />
        <StatBox value={`${votesAgg._sum.voteCount ?? 0}`} label="投票" />
      </section>

      {/* 继续学习 */}
      {recent.length > 0 && (
        <section className="studio-rise">
          <h2 className="mb-3.5 text-[18px] font-bold text-[var(--ink)]">继续学习</h2>
          <div className="flex flex-col gap-2.5">
            {recent.map((r) => (
              <Link
                key={r.lessonId}
                href={`/courses/${r.course.slug}/learn/${r.lesson.id}`}
                className="studio-lift flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-[var(--ink)]">{r.course.title}</p>
                  <p className="truncate text-[12px] text-[var(--ink3)]">{r.lesson.title}</p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-[var(--red)]">继续 →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 菜单 */}
      <section className="studio-rise flex flex-col gap-2.5">
        <MenuLink href="/me/subscription" label="订阅管理" hint={meta.label} />
        <MenuLink href="/notes" label="我的笔记" hint={`${notesCount} 条`} />
        <MenuLink href="/me/settings" label="设置（长辈模式 / 字号）" />
        <MenuLink href="/demands" label="我的共创需求" />
        {user.role !== "user" && <MenuLink href="/admin" label="运营后台" hint="管理" />}
      </section>

      <section className="flex flex-col gap-2.5 pt-2">
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-4 text-[13px] text-[var(--ink2)]">
          <p className="font-bold text-[var(--ink)]">客服与反馈</p>
          <p className="mt-1">遇到问题？发送邮件到 support@tide.learning，或在需求广场留言。</p>
        </div>
        <LogoutButton />
        <button className="w-full rounded-[13px] px-4 py-3 text-left text-[13px] text-[var(--ink4)] transition-colors hover:text-[var(--red)]">
          注销账号
        </button>
      </section>
    </div>
  );
}

function WeekStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <span className="text-[13px] text-[var(--ink2)]">{label}</span>
      <span className="mono text-[22px] font-bold text-[var(--ink)]">{value}</span>
    </div>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-2 py-4 text-center shadow-[var(--card)] sm:p-4">
      <div className="mono text-[20px] font-bold text-[var(--ink)]">{value}</div>
      <div className="mt-0.5 text-[12px] text-[var(--ink3)]">{label}</div>
    </div>
  );
}

function MenuLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link
      href={href}
      className="studio-lift flex items-center justify-between rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--card)]"
    >
      <span className="text-[14px] font-semibold text-[var(--ink)]">{label}</span>
      <span className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
        {hint}
        <span className="text-[var(--ink4)]">›</span>
      </span>
    </Link>
  );
}
