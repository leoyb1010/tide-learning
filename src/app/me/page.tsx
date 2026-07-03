import Link from "next/link";
import { redirect } from "next/navigation";
import { Crown, CaretRight, Cards, Play, Flame, Medal } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { getGamificationSummary } from "@/lib/gamification";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/AccountActions";
import { TideCalendar } from "@/components/TideCalendar";
import { formatDurationSec } from "@/lib/format";
import { relativeTime } from "@/lib/queries";
import { shanghaiDayKey } from "@/lib/week";

export const metadata = { title: "我的" };

// 学号：userId 短哈希（与 layout.tsx 的 shortStudentId 同算法，就地内联，不共享 import）
function shortStudentId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  const b = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 去掉易混 I/L/O/U
  let c = "";
  for (let i = 0; i < 5; i++) {
    c = b[h % 32] + c;
    h = Math.floor(h / 32);
  }
  return `STU-${c}`;
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const now = new Date();
  const [snapshot, progressAgg, completedCount, notesCount, learning, dueCount, gamification] =
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
    ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;
  const studentId = shortStudentId(user.id);
  const joinedLabel = `入学 ${user.createdAt.getFullYear()}.${String(user.createdAt.getMonth() + 1).padStart(2, "0")}`;

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
      {/* ============ 第一段 · 学生证 Plus（证件质感：深蓝黑渐变 + 柔光 + 芯片）============ */}
      <section
        className="studio-rise relative overflow-hidden rounded-[20px] p-6 text-white shadow-[var(--lift)] sm:p-7"
        style={{
          background:
            "linear-gradient(135deg, #1c2432 0%, #141a24 46%, #0f141c 100%)",
        }}
      >
        {/* 右上柔光：给纯深底加材质层次，避免死黑 */}
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-[0.5] blur-[60px]"
          style={{ background: "radial-gradient(circle, rgba(252,1,26,0.28) 0%, transparent 70%)" }}
          aria-hidden
        />
        {/* 细网格纹理：极淡，增加"证件"精密感 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden
        />
        {/* 左缘红校条 */}
        <div className="absolute inset-y-0 left-0 w-[3px] bg-[var(--red)]" aria-hidden />

        <div className="relative flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
          {/* 左侧：头像 + 身份 */}
          <div className="flex items-center gap-4">
            <div className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-[24px] font-bold ring-1 ring-white/10">
              {user.nickname.slice(0, 1)}
              {snapshot.isSubscriber && (
                <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_2px_8px_-1px_rgba(252,1,26,0.6)]">
                  <Crown size={12} weight="fill" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[20px] font-bold leading-tight">{user.nickname}</p>
              <p className="mono mt-1 text-[12px] tracking-[0.12em] text-white/50">{studentId}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-white/45">
                <span className="mono">{joinedLabel}</span>
                <span className="h-[3px] w-[3px] rounded-full bg-white/25" aria-hidden />
                <span className="text-white/60">{meta.label}</span>
              </div>
            </div>
          </div>

          {/* 右侧：三个核心数（芯片分隔） */}
          <div className="flex items-center gap-6 sm:gap-9">
            <IdStat value={formatDurationSec(progressAgg._sum.progressSec ?? 0)} label="累计学习" />
            <span className="h-9 w-px bg-white/10" aria-hidden />
            <IdStat value={`${completedCount}`} label="完课" />
            <span className="h-9 w-px bg-white/10" aria-hidden />
            <IdStat value={`${notesCount}`} label="笔记" />
          </div>
        </div>

        {/* 底部极小字 */}
        <p className="mono relative mt-6 text-[9.5px] uppercase tracking-[0.22em] text-white/30">
          YOUDAO STUDIO · STUDENT ID · {studentId}
        </p>
      </section>

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

      {/* ============ 菜单 + 设置 + 退出 ============ */}
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

// 学生证核心数（深色卡上，白字）
function IdStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center md:text-right">
      <div className="mono text-[22px] font-bold leading-none text-white">{value}</div>
      <div className="mt-1.5 text-[11px] text-white/50">{label}</div>
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
