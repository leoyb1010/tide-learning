import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretRight, Cards, Play, Flame, Medal, Check, ClockCounterClockwise, Storefront, Clock, NotePencil, Coins, Trophy, BookBookmark, ShoppingBag, TrendUp, ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { getGamificationSummary, getYearHeatmap } from "@/lib/gamification";
import { getBalance } from "@/lib/credits";
import { getAuthorEarnings } from "@/lib/credit-trade";
import { prisma } from "@/lib/db";
import { TideCalendar } from "@/components/TideCalendar";
import { YearHeatmap } from "@/components/YearHeatmap";
import { StudentCard, type StudentCardData } from "@/components/StudentCard";
import { CreditCard } from "@/components/CreditCard";
import { SharePanel } from "@/components/SharePanel";
import { formatDurationSec } from "@/lib/format";
import { relativeTime } from "@/lib/queries";
import { trackGradientVar } from "@/lib/tracks";
import { shanghaiDayKey } from "@/lib/week";

export const metadata = { title: "成长档案" };

/** 证件编号：YD·{入学年}·{userId 派生 4 位序号}（比 hash 更像证件语法）。 */
function studentNo(id: string, year: number): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `YD·${year}·${String(h % 10000).padStart(4, "0")}`;
}

/**
 * 续学 Hero 的「潮汐召回文案」：把冷冰冰的相对时间变成情绪化召回。
 * 今天=涨潮中(红)，1-2 天=昨天/前天(弱)，≥3 天=退潮 N 天(warn 召回)。
 */
function recallLine(last: Date, now: Date): { text: string; tone: string; dot: string } {
  const dayMs = 86_400_000;
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d1 = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
  const days = Math.max(0, Math.round((d0 - d1) / dayMs));
  if (days === 0) return { text: "今天 · 涨潮中", tone: "text-[var(--red)]", dot: "bg-[var(--red)]" };
  if (days === 1) return { text: "昨天学过", tone: "text-[var(--ink3)]", dot: "bg-[var(--ink4)]" };
  if (days === 2) return { text: "前天学过", tone: "text-[var(--ink3)]", dot: "bg-[var(--ink4)]" };
  return { text: `退潮 ${days} 天了，回来一下？`, tone: "text-[var(--warn)]", dot: "bg-[var(--warn)]" };
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const now = new Date();
  const [
    snapshot,
    progressAgg,
    completedCount,
    notesCount,
    learning,
    dueCount,
    gamification,
    profile,
    yearHeat,
    balance,
    notebookCount,
    purchasedCount,
    earnings,
  ] = await Promise.all([
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
        course: { select: { slug: true, title: true, category: true } },
        lesson: { select: { id: true, title: true, durationSec: true } },
      },
    }),
    // 我的复习：到期待复习卡数
    prisma.reviewCard.count({ where: { userId: user.id, dueAt: { lte: now } } }),
    getGamificationSummary(user.id),
    prisma.userProfile.findUnique({ where: { userId: user.id }, select: { motto: true } }),
    getYearHeatmap(user.id),
    // v3.2 成长档案丰富化：积分余额 / 笔记本数 / 已购课程数 / 待清错题数 / 创作者收益
    getBalance(user.id),
    prisma.notebook.count({ where: { userId: user.id } }),
    prisma.coursePurchase.count({ where: { userId: user.id } }),
    getAuthorEarnings(user.id),
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
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
      {/* ============ 第一段 · 学生证（v2.3 纸质证件）+ 积分卡 ============ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col">
          {/* 分享学生证按钮放进抬头带 flex 流内（headerAction 插槽），与「会员」胶囊并排不重叠 */}
          <StudentCard
            data={cardData}
            headerAction={
              <SharePanel
                kind="student-card"
                title="分享学生证"
                shareUrl={`/u/${user.id}`}
                triggerLabel="分享学生证"
                triggerClassName="group studio-press inline-flex h-7 w-7 items-center justify-center rounded-[9px] border border-[var(--hairline-on-dark)] bg-white/10 text-[var(--ink-on-dark-2)] backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-[var(--ink-on-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              />
            }
          />
        </div>
        <CreditCard />
      </div>

      {/* ============ 数据总览条（一眼看到自己在这里积累了什么）============ */}
      <section className="studio-rise grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        <OverviewStat icon={<Clock size={16} weight="fill" />} label="累计学习" value={formatDurationSec(progressAgg._sum.progressSec ?? 0)} />
        <OverviewStat icon={<Check size={16} weight="bold" />} label="完成课程" value={String(completedCount)} />
        <OverviewStat icon={<NotePencil size={16} weight="fill" />} label="笔记" value={String(notesCount)} />
        <OverviewStat icon={<Flame size={16} weight="fill" />} label="连续天数" value={String(gamification.currentStreak)} accent />
        <OverviewStat icon={<Trophy size={16} weight="fill" />} label="获得成就" value={String(gamification.achievements.length)} />
        <OverviewStat icon={<Coins size={16} weight="fill" />} label="积分" value={balance.toLocaleString()} />
      </section>

      {/* ============ 第二段 · 学习进度（主体）============ */}
      <section className="studio-rise flex flex-col gap-4">
        <h2 className="text-[18px] font-bold text-[var(--ink)]">学习进度</h2>

        {learning.length > 0 ? (
          <div className="stagger flex flex-col gap-3">
            {/* 层1 · 续学 Hero 卡：赛道渐变色块 + 环形进度 + 潮汐召回文案 */}
            {(() => {
              const r = learning[0];
              const dur = r.lesson.durationSec;
              const pct = dur > 0 ? Math.min(Math.round((r.progressSec / dur) * 100), 100) : 0;
              const done = pct >= 100;
              const recall = recallLine(r.lastPlayedAt, now);
              return (
                <Link
                  href={`/courses/${r.course.slug}/learn/${r.lesson.id}`}
                  style={{ "--i": 0 } as React.CSSProperties}
                  className="studio-lift group flex overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
                >
                  {/* 左：赛道渐变 + 环形进度 */}
                  <div
                    className="relative flex w-[120px] shrink-0 items-center justify-center sm:w-[168px]"
                    style={{ background: trackGradientVar(r.course.category) }}
                  >
                    <span className="pointer-events-none absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 70% 20%, rgba(255,255,255,0.35), transparent 60%)" }} aria-hidden />
                    <div
                      className="relative grid h-[76px] w-[76px] place-items-center rounded-full"
                      style={{ background: `conic-gradient(#fff ${pct * 3.6}deg, rgba(255,255,255,0.28) 0deg)` }}
                      aria-hidden
                    >
                      <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-black/25 text-white backdrop-blur-sm">
                        {done ? <ArrowClockwise size={22} weight="bold" /> : <Play size={22} weight="fill" />}
                      </span>
                    </div>
                  </div>
                  {/* 右：续学信息 */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-5">
                    <span className="mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink4)]">
                      CONTINUE · 上次学到
                    </span>
                    <p className="truncate text-[17px] font-bold text-[var(--ink)]">{r.course.title}</p>
                    <p className="truncate text-[13px] text-[var(--ink3)]">{r.lesson.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${recall.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${recall.dot}`} aria-hidden />
                        {recall.text}
                      </span>
                      <span className="mono text-[12px] font-semibold text-[var(--ink3)]">{pct}%</span>
                      <span className="cta-glow ml-auto inline-flex items-center gap-1 rounded-[10px] bg-[var(--red)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-transform group-hover:translate-x-0.5">
                        {done ? "重温" : "继续学习"} <Play size={12} weight="fill" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })()}

            {/* 层2 · 其余在学课：双列紧凑卡 + 赛道色竖条 + 刻度进度 */}
            {learning.length > 1 && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {learning.slice(1).map((r, i) => {
                  const dur = r.lesson.durationSec;
                  const pct = dur > 0 ? Math.min(Math.round((r.progressSec / dur) * 100), 100) : 0;
                  const done = pct >= 100;
                  return (
                    <Link
                      key={r.lessonId}
                      href={`/courses/${r.course.slug}/learn/${r.lesson.id}`}
                      style={{ "--i": i + 1 } as React.CSSProperties}
                      className="studio-lift hover-sheen relative flex flex-col gap-2.5 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 pl-5 shadow-[var(--card),var(--inner-hi)]"
                    >
                      {/* 赛道色竖条 */}
                      <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r" style={{ background: trackGradientVar(r.course.category) }} aria-hidden />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold text-[var(--ink)]">{r.course.title}</p>
                          <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink3)]">{r.lesson.title}</p>
                        </div>
                        {done ? (
                          <span className="mono shrink-0 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ok)]">已学完</span>
                        ) : (
                          <span className="mono shrink-0 text-[11px] font-semibold text-[var(--ink3)]">{pct}%</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                          <div className={`h-full rounded-full ${done ? "bg-[var(--ok)]" : "bg-[var(--red)]"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="mono text-[10px] text-[var(--ink4)]">{relativeTime(r.lastPlayedAt)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center shadow-[var(--card),var(--inner-hi)]">
            {/* 构图：同心圆导引 + 播放符号，替代单调灰图标 */}
            <div className="relative mx-auto grid h-20 w-20 place-items-center">
              <span className="absolute inset-0 rounded-full border border-[var(--border)]" aria-hidden />
              <span className="absolute inset-[10px] rounded-full border border-[var(--border2)]" aria-hidden />
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--red-soft)] text-[var(--red)]" aria-hidden>
                <Play size={20} weight="fill" />
              </span>
            </div>
            <p className="mt-5 text-[16px] font-bold text-[var(--ink)]">开启你的第一堂课</p>
            <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-[var(--ink3)]">
              挑一门感兴趣的课程，或从一个想法出发，让自习室为你生成专属内容。
            </p>
            <div className="mt-5 flex items-center justify-center gap-2.5">
              <Link
                href="/courses"
                className="studio-press cta-glow hover-sheen inline-flex items-center rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white"
              >
                去选课
              </Link>
              <Link
                href="/create"
                className="studio-press inline-flex items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--border2)]"
              >
                创建课程
              </Link>
            </div>
          </div>
        )}

        {/* 层3 · 入口行：全部学习记录 + 我的复习（等高两列对齐）*/}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {learning.length > 0 && (
            <Link
              href="/me/history"
              className="studio-lift hover-sheen flex min-h-[68px] items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--surface-inset)] text-[var(--ink3)]">
                  <ClockCounterClockwise size={18} weight="fill" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-[var(--ink)]">全部学习记录</p>
                  <p className="truncate text-[12px] text-[var(--ink3)]">按课程分组看进度足迹</p>
                </div>
              </div>
              <CaretRight size={15} weight="bold" className="shrink-0 text-[var(--ink4)]" />
            </Link>
          )}

          {/* 我的复习入口（待复习用 --warn 语义，红只留给关键信号） */}
          <Link
            href="/review"
            className="studio-lift hover-sheen flex min-h-[68px] items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${dueCount > 0 ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--surface-inset)] text-[var(--ink3)]"}`}
              >
                <Cards size={18} weight="fill" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-[var(--ink)]">我的复习</p>
                <p className="text-[12px] text-[var(--ink3)]">
                  {dueCount > 0 ? (
                    <>
                      <span className="mono font-semibold text-[var(--warn)]">{dueCount}</span> 张待复习
                    </>
                  ) : (
                    "暂无到期复习卡"
                  )}
                </p>
              </div>
            </div>
            <CaretRight size={15} weight="bold" className="shrink-0 text-[var(--ink4)]" />
          </Link>
        </div>
      </section>

      {/* ============ 学习资产（我在平台沉淀的东西：笔记本 / 已购课程）============ */}
      <section className="studio-rise grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/notes?view=notebook"
          className="studio-lift hover-sheen flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--info-soft)] text-[var(--info)]">
              <BookBookmark size={18} weight="fill" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)]">我的笔记本</p>
              <p className="text-[12px] text-[var(--ink3)]">
                {notebookCount > 0 ? (
                  <>
                    <span className="mono font-semibold text-[var(--ink2)]">{notebookCount}</span> 个主题空间
                  </>
                ) : (
                  "把笔记归入主题空间，成体系"
                )}
              </p>
            </div>
          </div>
          <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
        </Link>

        <Link
          href="/me/courses"
          className="studio-lift hover-sheen flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--surface-inset)] text-[var(--ink3)]">
              <ShoppingBag size={18} weight="fill" />
            </div>
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)]">我的课程</p>
              <p className="text-[12px] text-[var(--ink3)]">
                {purchasedCount > 0 ? (
                  <>
                    已入手 <span className="mono font-semibold text-[var(--ink2)]">{purchasedCount}</span> 门 · 含创建与订阅
                  </>
                ) : (
                  "已购、已创建与订阅可学的课都在这"
                )}
              </p>
            </div>
          </div>
          <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
        </Link>
      </section>

      {/* ============ 第三段 · 成长足迹（次要）============ */}
      <section className="studio-rise flex flex-col gap-4 border-t border-[var(--border)] pt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-bold text-[var(--ink)]">成长足迹</h2>
          {/* 学习周报：把本周节奏一键生成分享图，ghost 文本按钮不与红信号争抢 */}
          <SharePanel
            kind="week-report"
            title="学习周报"
            triggerLabel="生成学习周报"
            triggerClassName="studio-press inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
          />
        </div>

        {/* 连续学习 + 本周数据 + 本周节奏柱图 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 连续学习（深色展示区：渐变 + 红数字主视觉 + 柔光，体验高峰） */}
          <div
            className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--hairline-on-dark)] p-5 shadow-[var(--lift)]"
            style={{ background: "var(--video-grad)" }}
          >
            {/* 右下红色柔光晕，暗区不死黑 */}
            <span
              className="pointer-events-none absolute -bottom-10 -right-8 h-32 w-32 rounded-full opacity-40 blur-2xl"
              style={{ background: "radial-gradient(circle, var(--red) 0%, transparent 70%)" }}
              aria-hidden
            />
            <div className="relative flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on-dark-3)]">连续学习</span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--red)] text-white shadow-[var(--red-glow)]">
                <Flame size={15} weight="fill" />
              </span>
            </div>
            <div className="relative mt-2 flex items-baseline gap-1">
              <span
                key={gamification.currentStreak}
                className="num-pop mono text-[52px] font-extrabold leading-none tracking-tight text-[var(--red)]"
              >
                {gamification.currentStreak}
              </span>
              <span className="text-[15px] text-[var(--ink-on-dark-2)]">天</span>
            </div>
            {/* 14 格进度（映射到满月目标进度） */}
            <div className="relative mt-4 flex gap-1">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < Math.round(streakPct * 14) ? "bg-[var(--red)]" : "bg-[var(--hairline-on-dark)]"}`}
                />
              ))}
            </div>
            <p className="relative mt-3 text-[12px] text-[var(--ink-on-dark-2)]">
              {daysToGoal > 0 ? `再学 ${daysToGoal} 天解锁满月徽章` : "已解锁满月徽章"}
            </p>
          </div>

          {/* 本周数据 */}
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
            <WeekStat label="本周时长" value={formatDurationSec(weekMinutes * 60)} />
            <div className="mx-5 border-t border-[var(--border)]" />
            <WeekStat label="活跃天数" value={`${weekActiveDays} 天`} accent={weekActiveDays > 0} />
            <div className="mx-5 border-t border-[var(--border)]" />
            <WeekStat label="新增笔记" value={`${weekNotes} 条`} />
          </div>

          {/* 本周节奏柱状图（峰值日红色点睛，柱体递延升起） */}
          <div className="flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-bold text-[var(--ink)]">本周学习节奏</h3>
              <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">分钟 · 天</span>
            </div>
            <div className="stagger mt-4 flex flex-1 items-end justify-between gap-2" style={{ minHeight: 108 }}>
              {weekDays.map((d, i) => {
                const h = d.minutes > 0 ? Math.max((d.minutes / peakMinutes) * 100, 8) : 0;
                const isPeak = d.minutes >= peakMinutes;
                const isToday = i === todayLocalDow;
                return (
                  <div key={i} style={{ "--i": i } as React.CSSProperties} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-[88px] w-full items-end">
                      <div
                        className={`w-full rounded-t-[4px] transition-colors ${isPeak && d.minutes > 0 ? "bg-[var(--red)]" : d.minutes > 0 ? "bg-[var(--chart-bar-muted)]" : "bg-[var(--surface-inset)]"}`}
                        style={{ height: `${Math.max(h, d.minutes > 0 ? h : 4)}%` }}
                        title={d.isFuture ? undefined : `周${WEEK_LABELS[i]} · ${d.minutes} 分钟`}
                      />
                    </div>
                    <span
                      className={`mono text-[10px] ${isToday ? "font-bold text-[var(--ink2)]" : "text-[var(--ink4)]"}`}
                    >
                      {WEEK_LABELS[i]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 学习热力日历（TideCalendar：服务端按 Asia/Shanghai 定基准日，SSR/CSR 一致） */}
        <TideCalendar calendar={gamification.calendar} todayKey={todayKey} />

        {/* 学习热力年视图（GitHub 风格 365 天格：一整年的坚持一屏可见） */}
        <YearHeatmap days={yearHeat.days} todayKey={yearHeat.todayKey} />

        {/* 成就徽章 */}
        {gamification.achievements.length > 0 && (
          <div>
            <h3 className="mb-3.5 text-[14px] font-bold text-[var(--ink)]">成就徽章</h3>
            <div className="stagger grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
              {gamification.achievements.map((a, i) => {
                // 成就 key → 徽章图（缺省回退 emoji/icon 文本）
                const badgeImg: Record<string, string> = {
                  week_streak: "/badges/badge-streak.png",
                  first_subscribe: "/badges/badge-milestone.png",
                  first_note: "/badges/badge-note.png",
                  first_tide: "/badges/badge-tide.png",
                  cocreator: "/badges/badge-vote.png",
                };
                const img = badgeImg[a.key];
                return (
                  <div
                    key={a.key}
                    style={{ "--i": i } as React.CSSProperties}
                    className="studio-lift hover-sheen flex flex-col items-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 text-center shadow-[var(--card),var(--inner-hi)]"
                  >
                    {img ? (
                      <img src={img} alt={`${a.name} 徽章`} width={40} height={40} loading="lazy" className="h-10 w-10 object-contain" />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-inset)] text-[var(--ink2)]" aria-hidden>
                        <Medal size={22} weight="fill" />
                      </span>
                    )}
                    <p className="truncate text-[12px] font-semibold text-[var(--ink)]">{a.name}</p>
                    {/* 已获得用 --ok 语义（达成=成功绿），红留给关键信号 */}
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
                      <Check size={9} weight="bold" /> 已获得
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ============ 创作者中心入口（U4-a：作为作者的收益与销售看板）============ */}
      <Link
        href="/me/creator"
        className="studio-lift flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--red-soft)] text-[var(--red)]">
            <Storefront size={18} weight="fill" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[var(--ink)]">创作者中心</p>
            {earnings.courses.length > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-[var(--ink3)]">
                <span className="inline-flex items-center gap-1">
                  <TrendUp size={12} weight="fill" className="text-[var(--ok)]" />
                  收益 <span className="mono font-semibold text-[var(--ok)]">{earnings.totalIncome.toLocaleString()}</span>
                </span>
                <span>在架 <span className="mono font-semibold text-[var(--ink2)]">{earnings.courses.length}</span> 门</span>
                <span>成交 <span className="mono font-semibold text-[var(--ink2)]">{earnings.totalSales}</span> 笔</span>
              </p>
            ) : (
              <p className="text-[12px] text-[var(--ink3)]">你摆摊卖课的收益、销售与近期成交</p>
            )}
          </div>
        </div>
        <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
      </Link>

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

/** 数据总览条单元：图标 + 大数值 + 标签，居中材质卡。 */
function OverviewStat({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="studio-lift flex flex-col items-center gap-1 rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center shadow-[var(--card),var(--inner-hi)]">
      <span className={accent ? "text-[var(--red)]" : "text-[var(--ink3)]"}>{icon}</span>
      <span className={`mono text-[17px] font-extrabold leading-none ${accent ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
        {value}
      </span>
      <span className="text-[11px] leading-tight text-[var(--ink4)]">{label}</span>
    </div>
  );
}

function WeekStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <span className="text-[13px] text-[var(--ink2)]">{label}</span>
      <span className={`mono text-[22px] font-bold ${accent ? "text-[var(--ok)]" : "text-[var(--ink)]"}`}>{value}</span>
    </div>
  );
}

