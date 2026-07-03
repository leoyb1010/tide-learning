import Link from "next/link";
import {
  ArrowRight,
  Play,
  Microphone,
  Sparkle,
  House,
  UsersThree,
  Waveform,
} from "@phosphor-icons/react/dist/ssr";
import { listCourses, listUpdates, listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { VoteButton } from "@/components/VoteButton";
import { TidalReveal as Reveal } from "@/components/motion";
import { TrackView } from "@/components/TrackView";
import { TRACKS } from "@/lib/tracks";

/**
 * 首页 · STUDIO 视觉复刻
 * 品牌叙事：把「潮汐」改为「自习室」——今天，把这间自习室点亮。
 * 结构：1) Hero（点亮自习室文案 + 续播深色卡） 2) 课程赛道 grid-cols-4 3) 共创 + 订阅 teaser
 * 保留全部数据查询（listCourses / listUpdates / listRankedDemands / plans）、权益解析与所有链接。
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  const [all, updates, demands, plans] = await Promise.all([
    listCourses({ sort: "recommended" }),
    listUpdates(8),
    listRankedDemands(["collecting", "evaluating", "scheduled", "producing"]),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
  ]);
  const snapshot = await resolveEntitlement(user?.id ?? null);

  const featured = all.filter((c) => c.isFeatured);
  const hero = featured[0] ?? all[0];

  // 每条赛道领起自己的课程组；用于「课程赛道」grid（含每条赛道的新上新计数）。
  const newSlugs = new Set(updates.map((u) => u.courseSlug));
  const trackLines = TRACKS.map((t) => {
    const courses = all.filter((c) => c.category === t.key);
    return { track: t, courses, newCount: courses.filter((c) => newSlugs.has(c.slug)).length };
  }).filter((l) => l.courses.length > 0);

  // 续播卡：拿一门带更新的精选课作为「上次学到」的展示素材（纯视觉，链接指向课程）。
  const resume = hero;
  const topDemand = demands[0];
  // 订阅 teaser：优先全站年费方案。
  const yearPlan =
    plans.find((p) => p.scope === "all" && p.billingPeriod === "year") ??
    plans.find((p) => p.scope === "all") ??
    plans[0];

  // 眉标日期（保持 SSR 稳定：直接取当前日期格式化）
  const now = new Date();
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
  const dateLabel = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const greeting = now.getHours() < 12 ? "上午好" : now.getHours() < 18 ? "下午好" : "晚上好";
  const displayName = user?.nickname ?? "同学";

  return (
    <div className="mx-auto flex max-w-[1060px] flex-col gap-24 md:gap-28">
      <TrackView event="homepage_view" properties={{ mode: "standard" }} />

      {/* ============ 1. HERO — 点亮自习室 + 续播深色卡 ============ */}
      <section className="flex flex-wrap items-center gap-x-12 gap-y-10">
        {/* 左：文案 */}
        <div className="min-w-[330px] flex-1 studio-rise">
          <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink3)]">
            {weekday} · {dateLabel} · {greeting}，{displayName}
          </p>
          <h1 className="mt-4 text-[30px] font-bold leading-[1.4] text-[var(--ink)] sm:text-[34px]">
            今天，把这间
            <br />
            自习室<span className="text-[var(--red)]">点亮</span>。
          </h1>
          <p className="mt-5 max-w-[380px] text-[15px] leading-[1.8] text-[var(--ink2)]">
            视频与笔记在同一张桌面。边看边记，随手截帧成卡；口语实战、AI 技能、银发英语、生活实用，每周持续更新，投票决定下一门课。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={resume ? `/courses/${resume.slug}` : "/courses"}
              className="studio-press inline-flex items-center gap-2 rounded-[13px] bg-[var(--ink)] px-5 py-3 text-[14px] font-bold text-[var(--surface)] transition-colors hover:opacity-90"
            >
              <Play size={15} weight="fill" />
              继续上次学习
            </Link>
            <Link
              href="/courses"
              className="studio-press inline-flex items-center gap-2 rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-[14px] font-bold text-[var(--ink)] transition-colors hover:border-[var(--border2)]"
            >
              浏览课程
              <ArrowRight size={15} weight="bold" />
            </Link>
          </div>
        </div>

        {/* 右：续播深色卡 */}
        {resume && (
          <Link
            href={`/courses/${resume.slug}`}
            className="studio-lift studio-rise block max-w-[430px] flex-1 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card)]"
          >
            {/* 16:9 深色封面 */}
            <div
              className="relative aspect-[16/9] w-full overflow-hidden rounded-[13px]"
              style={{ background: "linear-gradient(140deg,#232935 0%,#141821 100%)" }}
            >
              {/* 水印「习」 */}
              <span className="pointer-events-none absolute -bottom-4 right-2 select-none text-[120px] font-black leading-none text-white/[0.06]">
                习
              </span>
              {/* 底部渐变 */}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
              {/* 左上：上次学到 04:12 */}
              <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] text-[var(--red)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />
                <span className="mono">上次学到 04:12</span>
              </div>
              {/* 课程标题 */}
              <p className="absolute inset-x-4 bottom-9 text-[13px] font-semibold text-white">
                {resume.title}
              </p>
              {/* 播放圆 46 */}
              <div className="absolute left-4 bottom-[52px] flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                <Play size={18} weight="fill" className="ml-0.5 text-white" />
              </div>
              {/* 进度条 42% */}
              <div className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-[var(--red)]" style={{ width: "42%" }} />
              </div>
            </div>
            {/* 卡底行 */}
            <div className="mt-3.5 flex items-center justify-between px-1">
              <div>
                <p className="text-[13px] font-semibold text-[var(--ink)]">{resume.title}</p>
                <p className="mono mt-0.5 text-[11px] text-[var(--ink3)]">
                  已记 3 条 · 剩 6 分钟
                </p>
              </div>
              <span className="mono shrink-0 text-[13px] font-semibold text-[var(--red)]">64%</span>
            </div>
          </Link>
        )}
      </section>

      {/* ============ 2. 课程赛道 — grid-cols-4 ============ */}
      <section>
        <Reveal>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">TRACKS</p>
              <h2 className="mt-1.5 text-[18px] font-bold text-[var(--ink)]">课程赛道</h2>
            </div>
            <Link
              href="/courses"
              className="group inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--red)]"
            >
              全部赛道
              <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {trackLines.map((l, i) => (
            <TrackCard key={l.track.key} line={l} index={i} />
          ))}
        </div>
      </section>

      {/* ============ 3. 共创 + 订阅 teaser ============ */}
      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* 共创卡 */}
        <div className="studio-lift flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">CO-CREATE</p>
              <h2 className="mt-1.5 text-[18px] font-bold text-[var(--ink)]">共创广场</h2>
            </div>
            <Link
              href="/demands"
              className="group inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--red)]"
            >
              你想学的，投票决定
              <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {topDemand ? (
            <div className="mt-5 flex items-center gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/demands/${topDemand.id}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--ink)] hover:text-[var(--red)]">
                    {topDemand.title}
                  </span>
                  <span className="rounded-full bg-[var(--red-soft)] border border-[var(--red-soft-border)] px-2.5 py-1 text-[11px] text-[var(--red)]">
                    {topDemand.categoryLabel} · 已进入排期
                  </span>
                </Link>
                {topDemand.description && (
                  <p className="mt-1 line-clamp-1 text-[13px] text-[var(--ink3)]">{topDemand.description}</p>
                )}
              </div>
              <div className="shrink-0">
                <VoteButton
                  demandId={topDemand.id}
                  initialVotes={topDemand.totalVotes}
                  canVote={snapshot.canVote}
                  disabledReason={snapshot.canVote ? undefined : "订阅后可投票"}
                />
              </div>
            </div>
          ) : (
            <p className="mt-5 text-[13px] text-[var(--ink3)]">还没有需求，去发起第一条吧。</p>
          )}

          <Link
            href="/demands"
            className="mono mt-4 inline-flex items-center gap-1.5 text-[11px] text-[var(--ink3)] hover:text-[var(--red)]"
          >
            <UsersThree size={13} />
            共 {demands.length} 条在征集 · 每周排期一次
          </Link>
        </div>

        {/* 订阅卡（深底 + 右下红圆装饰） */}
        <div className="relative flex flex-col overflow-hidden rounded-[16px] bg-[var(--video-bg)] p-6 text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(252,1,26,0.45), transparent 70%)" }}
          />
          <div className="relative z-10 flex flex-1 flex-col">
            <p className="mono text-[10px] uppercase tracking-[0.14em] text-white/50">SUBSCRIBE</p>
            <h2 className="mt-2 text-[18px] font-bold">年度会员 · 持续更新</h2>
            <p className="mono mt-3 text-[13px] text-white/70">
              {yearPlan ? `¥${(yearPlan.priceCents / 100).toFixed(0)}/年` : "订阅制"} · 全部赛道畅学
            </p>
            <p className="mt-2 text-[13px] leading-[1.7] text-white/60">
              停订后笔记与截帧永久保存。随时可取消。
            </p>
            <Link
              href="/pricing"
              className="group mt-auto inline-flex items-center gap-1.5 pt-6 text-[13px] font-semibold text-white"
            >
              查看方案
              <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- 局部组件 ---------- */

// 赛道图标：按 key 选一个语义图标。
const TRACK_ICONS: Record<string, React.ReactNode> = {
  english_oral: <Microphone size={18} weight="fill" />,
  english_foundation: <Waveform size={18} weight="fill" />,
  silver_english: <UsersThree size={18} weight="fill" />,
  ai_skill: <Sparkle size={18} weight="fill" />,
  life: <House size={18} weight="fill" />,
};

function TrackCard({
  line,
  index,
}: {
  line: { track: import("@/lib/tracks").Track; courses: unknown[]; newCount: number };
  index: number;
}) {
  const { track, courses, newCount } = line;
  // 银发赛道用深色卡强调（spec：银发深色卡）。
  const isDark = track.key === "silver_english";
  return (
    <Reveal delay={index * 0.05}>
      <Link
        href={`/courses?category=${track.key}`}
        className={`studio-lift flex h-full flex-col rounded-[16px] border p-[18px] shadow-[var(--card)] ${
          isDark
            ? "border-transparent bg-[var(--video-bg)] text-white"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]"
        }`}
      >
        {/* 图标盒 38 */}
        <div
          className={`flex h-[38px] w-[38px] items-center justify-center rounded-[11px] ${
            isDark ? "bg-white/10 text-white" : "bg-[var(--red-soft)] text-[var(--red)]"
          }`}
        >
          {TRACK_ICONS[track.key] ?? <Sparkle size={18} weight="fill" />}
        </div>
        {/* 名称 */}
        <p className={`mt-4 text-[15px] font-bold ${isDark ? "text-white" : "text-[var(--ink)]"}`}>
          {track.label}
        </p>
        <p className={`mt-1 text-[12px] leading-[1.5] ${isDark ? "text-white/55" : "text-[var(--ink3)]"}`}>
          {track.blurb}
        </p>
        {/* 底部：课程数 + 新上新 */}
        <div className="mt-auto flex items-center gap-2 pt-4">
          <span className={`mono text-[12px] font-semibold ${isDark ? "text-white/80" : "text-[var(--red)]"}`}>
            +{courses.length}
          </span>
          <span className={`text-[11px] ${isDark ? "text-white/45" : "text-[var(--ink4)]"}`}>门课程</span>
          {newCount > 0 && (
            <span className="ml-auto rounded-full bg-[var(--new-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--new-ink)]">
              {newCount} 节新课上新
            </span>
          )}
        </div>
      </Link>
    </Reveal>
  );
}
