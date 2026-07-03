import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretRight, Cards, Play, Flame, Medal } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { getGamificationSummary } from "@/lib/gamification";
import { prisma } from "@/lib/db";
import { TideCalendar } from "@/components/TideCalendar";
import { StudentCard, type StudentCardData } from "@/components/StudentCard";
import { CreditCard } from "@/components/CreditCard";
import { formatDurationSec } from "@/lib/format";
import { relativeTime } from "@/lib/queries";
import { shanghaiDayKey } from "@/lib/week";

export const metadata = { title: "成长档案" };

/** 证件编号：YD·{入学年}·{userId 派生 4 位序号}（比 hash 更像证件语法）。 */
function studentNo(id: string, year: number): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `YD·${year}·${String(h % 10000).padStart(4, "0")}`;
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const now = new Date();
  const [snapshot, progressAgg, completedCount, notesCount, learning, dueCount, gamification, profile] =
    await Promise.all([
      resolveEntitlement(user.id),
      prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
      // 完课数：completedAt 非空即已完成（schema 无 completed 布尔字段）
      prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }),
      prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
      // 学习中：全部有进度的课程（越权铁律：where userId）
      prisma.learningProgress.findMany({
        where: { userId: user.id },
        orderBy: { lastPlayedAt: "desc" },
        take: 10,
        include: {
          course: { select: { slug: true, title: true } },
          lesson: { select: { id: true, title: true, durationSec: true } },
        },
      }),
      // 我的复习：到期待复习卡数
      prisma.reviewCard.count({ where: { userId: user.id, dueAt: { lte: now } } }),
      getGamificationSummary(user.id),
      prisma.userProfile.findUnique({ where: { userId: user.id }, select: { motto: true } }),
    ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;
  const j = user.createdAt;
  // 学生证数据（v2.3 §2）
  const cardData: StudentCardData = {
    userId: user.id,
    nickname: user.nickname,
    pinyin: null, // 拼音 P1（可接拼音库或存储字段）
    studentNo: studentNo(user.id, j.getFullYear()),
    joinedYear: j.getFullYear(),
    joinedMonth: j.getMonth() + 1,
    totalSeconds: progressAgg._sum.progressSec ?? 0,
    streak: gamification.currentStreak,
    isSubscriber: snapshot.isSubscriber,
    validLabel: snapshot.isSubscriber ? (snapshot.validUntil ? `VALID ${snapshot.validUntil.slice(0, 7).replace("-", ".")}` : "VALID FOREVER") : "免费学员",
    motto: profile?.motto ?? "日拱一卒，功不唐捐",
    avatarUrl: user.avatarUrl,
  };

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
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
      {/* ============ 第一段 · 学生证（v2.3 纸质证件）+ 积分卡 ============ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <StudentCard data={cardData} />
        <CreditCard />
      </div>

      {/* ============ 第二段 · 学习进度（主体）============ */}
      <section className="studio-rise flex flex-col gap-4">
        <h2 className="text-[18px] font-bold text-[var(--ink)]">学习进度</h2>

        {learning.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {learning.map((r) => {
              const dur = r.lesson.durationSec;
              const pct = dur > 0 ? Math.min(Math.round((r.progressSec / dur) * 100), 100) : 0;
              return (
                <div
                  key={r.lessonId}
                  className="studio-lift rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-bold text-[var(--ink)]">{r.course.title}</p>
                      <p className="mt-0.5 truncate text-[12px] text-[var(--ink3)]">{r.lesson.title}</p>
                    </div>
                    <Link
                      href={`/courses/${r.course.slug}/learn/${r.lesson.id}`}
                      className="studio-press inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[var(--red)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      <Play size={12} weight="fill" /> 继续
                    </Link>
                  </div>
                  {/* 进度条 */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                      <div className="h-full rounded-full bg-[var(--red)]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="mono shrink-0 text-[11px] font-semibold text-[var(--ink3)]">{pct}%</span>
                  </div>
                  <p className="mono mt-2 text-[11px] text-[var(--ink4)]">
                    最近学习 · {relativeTime(r.lastPlayedAt)}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--card)]">
            <p className="text-[14px] font-semibold text-[var(--ink)]">还没有开始学习</p>
            <p className="mt-1 text-[13px] text-[var(--ink3)]">挑一门课，或从一个想法开始你的第一堂课。</p>
            <div className="mt-4 flex items-center justify-center gap-2.5">
              <Link
                href="/courses"
                className="rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                去选课
              </Link>
              <Link
                href="/create"
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--border2)]"
              >
                创建课程
              </Link>
            </div>
          </div>
        )}

        {/* 我的复习入口 */}
        <Link
          href="/review"
          className="studio-lift flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--red-soft)] text-[var(--red)]">
              <Cards size={18} weight="fill" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)]">我的复习</p>
              <p className="text-[12px] text-[var(--ink3)]">
                {dueCount > 0 ? (
                  <>
                    <span className="mono font-semibold text-[var(--red)]">{dueCount}</span> 张待复习
                  </>
                ) : (
                  "暂无到期复习卡"
                )}
              </p>
            </div>
          </div>
          <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
        </Link>
      </section>

      {/* ============ 第三段 · 成长足迹（次要）============ */}
      <section className="studio-rise flex flex-col gap-4 border-t border-[var(--border)] pt-6">
        <h2 className="text-[16px] font-bold text-[var(--ink)]">成长足迹</h2>

        {/* 连续学习 + 本周数据 + 本周节奏柱图 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 连续学习（浅色精致卡，红色数字主视觉） */}
          <div className="relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">连续学习</span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--red-soft)] text-[var(--red)]">
                <Flame size={15} weight="fill" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-[var(--font-jakarta)] text-[52px] font-extrabold leading-none text-[var(--red)]">
                {gamification.currentStreak}
              </span>
              <span className="text-[15px] text-[var(--ink3)]">天</span>
            </div>
            {/* 14 格进度（映射到满月目标进度） */}
            <div className="mt-4 flex gap-1">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < Math.round(streakPct * 14) ? "bg-[var(--red)]" : "bg-[var(--surface-inset)]"}`}
                />
              ))}
            </div>
            <p className="mt-3 text-[12px] text-[var(--ink3)]">
              {daysToGoal > 0 ? `再学 ${daysToGoal} 天解锁满月徽章` : "已解锁满月徽章"}
            </p>
          </div>

          {/* 本周数据 */}
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
            <WeekStat label="本周时长" value={formatDurationSec(weekMinutes * 60)} />
            <div className="mx-5 border-t border-[var(--border)]" />
            <WeekStat label="活跃天数" value={`${weekActiveDays} 天`} />
            <div className="mx-5 border-t border-[var(--border)]" />
            <WeekStat label="新增笔记" value={`${weekNotes} 条`} />
          </div>

          {/* 本周节奏柱状图 */}
          <div className="flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
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
        </div>

        {/* 学习热力日历（TideCalendar：服务端按 Asia/Shanghai 定基准日，SSR/CSR 一致） */}
        <TideCalendar calendar={gamification.calendar} todayKey={todayKey} />

        {/* 成就徽章 */}
        {gamification.achievements.length > 0 && (
          <div>
            <h3 className="mb-3.5 text-[14px] font-bold text-[var(--ink)]">成就徽章</h3>
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
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--red-soft)] text-[var(--red)]" aria-hidden>
                        <Medal size={22} weight="fill" />
                      </span>
                    )}
                    <p className="truncate text-[12px] font-semibold text-[var(--ink)]">{a.name}</p>
                    <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--red)]">
                      已获得
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ============ 设置入口（§7：杂项已拆到设置中心，这里只留一个入口）============ */}
      <Link
        href="/me/settings"
        className="studio-lift flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
      >
        <div>
          <p className="text-[14px] font-bold text-[var(--ink)]">设置</p>
          <p className="text-[12px] text-[var(--ink3)]">账号安全 · 订阅与积分 · 偏好 · 隐私 · 帮助</p>
        </div>
        <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
      </Link>
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

