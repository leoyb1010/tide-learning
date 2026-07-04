import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Play,
  Microphone,
  Sparkle,
  House,
  UsersThree,
  Waveform,
  NotePencil,
  ClockCounterClockwise,
  CheckCircle,
} from "@phosphor-icons/react/dist/ssr";
import { listCourses, listUpdates, listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { VoteButton } from "@/components/VoteButton";
import { AmbientVideo } from "@/components/AmbientVideo";
import { TidalReveal as Reveal } from "@/components/motion";
import { TrackView } from "@/components/TrackView";
import { TRACKS } from "@/lib/tracks";

/**
 * 首页 · 双态（v2.2）。
 * - 未登录：营销首页（Hero 点亮文案 + 三引擎 + 学习闭环 + 课程赛道 + 共创/订阅 teaser）。
 * - 登录后：书桌已独立成 /desk，这里直接 redirect 过去（书桌是登录用户的「家」）。
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/desk"); // 登录 → 书桌
  return <MarketingHome />;
}

/* ============================================================
   未登录：营销版首页（保留原有结构与全部查询）
   ============================================================ */
async function MarketingHome() {
  const user = await getCurrentUser(); // 此分支下必为 null，保留以维持权益解析签名一致
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

  // 全站课程总量（Hero 信任条数字）
  const totalCourses = all.length;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-24 md:gap-28">
      <TrackView event="homepage_view" properties={{ mode: "standard" }} />

      {/* ============ 1. HERO 点亮自习室 + 续播深色卡 ============ */}
      <section className="flex flex-wrap items-center gap-x-12 gap-y-10">
        {/* 左：文案 AI 自习室叙事（未登录营销主线） */}
        <div className="min-w-[330px] flex-1 stagger">
          <h1
            className="text-balance text-[30px] font-bold leading-[1.32] tracking-[-0.01em] text-[var(--ink)] sm:text-[36px]"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            说出你想学的，
            <br />
            AI 帮你
            <span className="relative whitespace-nowrap text-[var(--red)]">
              造一门课
              {/* 关键词红色重音下的柔性底纹，强化排版重心 */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-[0.1em] -z-10 h-[0.42em] rounded-[3px] bg-[var(--red-soft)]"
              />
            </span>
            。
          </h1>
          <p
            className="mt-5 max-w-[420px] text-[15px] leading-[1.85] text-[var(--ink2)]"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            不只是看课。在这里，一句话生成属于你的课程，导入资料升维成带测验与 AI
            伴侣的课，边学边记、到点复习。一张书桌，装下你的整个学习。
          </p>
          <div
            className="mt-8 flex flex-wrap items-center gap-3"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            <Link
              href="/create"
              className="cta-glow studio-press inline-flex items-center gap-2 rounded-[13px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white transition-[filter] hover:brightness-105"
            >
              <Sparkle size={15} weight="fill" />
              免费体验 AI 造课
            </Link>
            <Link
              href="/courses"
              className="studio-lift studio-press inline-flex items-center gap-2 rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-[14px] font-bold text-[var(--ink)]"
            >
              浏览课程库
              <ArrowRight size={15} weight="bold" />
            </Link>
          </div>
          {/* 信任条：真实课程量作社会证明锚点（大数字 + 小注解），更新节奏 + 权益辅助 */}
          <div
            className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[var(--ink3)]"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <span className="inline-flex items-baseline gap-1.5">
              <span className="mono num-pop text-[20px] font-bold leading-none text-[var(--ink)]">{totalCourses}</span>
              <span className="text-[12px]">门课程在架</span>
            </span>
            <span className="h-3 w-px bg-[var(--border2)]" />
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={13} weight="fill" className="text-[var(--ok)]" />
              每周排期上新
            </span>
            <span className="h-3 w-px bg-[var(--border2)]" />
            <span>笔记与截帧永久保存</span>
          </div>
        </div>

        {/* 右：续播深色卡（材质：深色区渐变 + 柔光，非死黑平面） */}
        {resume && (
          <Link
            href={`/courses/${resume.slug}`}
            className="studio-lift studio-poweron block max-w-[430px] flex-1 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
            style={{ boxShadow: "var(--card), var(--inner-hi)" }}
          >
            {/* 16:9 深色封面 · 真实产品演示视频铺底（--video-grad 作兜底 poster/底色，reduce-motion 只静帧）。
                所有下方叠层保持绝对定位，DOM 顺序在视频之后 → 天然叠在视频之上。 */}
            <div
              className="relative aspect-[16/9] w-full overflow-hidden rounded-[13px]"
              style={{ background: "var(--video-grad)" }}
            >
              <AmbientVideo
                src="/videos/marketing/hero-product-demo-loop.mp4"
                poster="/marketing/landing-hero-scene.jpg"
              />
              {/* 水印「习」 */}
              <span className="pointer-events-none absolute -bottom-4 right-2 select-none text-[120px] font-black leading-none text-white/[0.06]">
                习
              </span>
              {/* 顶部柔光高光，加材质深度 */}
              <div
                aria-hidden
                className="pointer-events-none absolute -left-6 -top-10 h-32 w-40 rounded-full blur-2xl"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.10), transparent 70%)" }}
              />
              {/* 底部渐变 */}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
              {/* 左上：正在播放（live 信号，红=关键状态） */}
              <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] text-[var(--red-ink)]">
                <span className="live-dot inline-flex h-1.5 w-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />
                </span>
                <span className="mono">上次学到 04:12</span>
              </div>
              {/* 课程标题 */}
              <p className="absolute inset-x-4 bottom-9 text-[13px] font-semibold text-white">
                {resume.title}
              </p>
              {/* 播放圆 46 */}
              <div className="absolute left-4 bottom-[52px] flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                <Play size={18} weight="fill" className="ml-0.5 text-white" />
              </div>
              {/* 进度条 42% */}
              <div className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-[var(--red)]" style={{ width: "42%" }} />
              </div>
            </div>
            {/* 卡底行 */}
            <div className="mt-3.5 flex items-center justify-between px-1">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{resume.title}</p>
                <p className="mono mt-0.5 text-[11px] text-[var(--ink3)]">已记 3 条 · 剩 6 分钟</p>
              </div>
              <span className="mono num-pop shrink-0 text-[13px] font-semibold text-[var(--red-ink)]">64%</span>
            </div>
          </Link>
        )}
      </section>

      {/* ============ 1.5 三引擎 AI 自习室的核心能力（非对称 bento：主引擎占宽） ============ */}
      <section>
        <Reveal>
          <div className="mb-7">
            <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink3)]">CORE ENGINES</p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-[var(--ink)]">
              不止是网课，是一间会造课的自习室
            </h2>
            <p className="mt-2 max-w-[560px] text-[14px] leading-[1.7] text-[var(--ink2)]">
              三个引擎，把「想学」变成「学会」。
            </p>
          </div>
        </Reveal>
        {/* bento：AI 造课主卡横跨两列（叙事重心），其余两卡纵列 */}
        <div className="stagger grid gap-4 md:grid-cols-3">
          {/* 主引擎：AI 造课（宽卡，深色展示区材质） */}
          <Link
            href="/create"
            style={{ "--i": 0 } as React.CSSProperties}
            className="studio-lift hover-sheen group relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-[var(--border)] p-6 text-white md:col-span-2"
          >
            <div aria-hidden className="absolute inset-0 -z-10" style={{ background: "var(--track-ai)" }} />
            {/* 顶部内高光，让渐变有材质而非平涂 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{ boxShadow: "var(--inner-hi)", background: "linear-gradient(160deg, rgba(255,255,255,0.10), transparent 40%)" }}
            />
            <div>
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                <Sparkle size={22} weight="fill" className="text-white" />
              </div>
              <h3 className="mt-4 text-[18px] font-bold">AI 造课</h3>
              <p className="mt-2 max-w-[380px] text-[13px] leading-[1.75] text-white/80">
                一句话说出想学的，AI 当场搭大纲、逐节写课件，还配好测验与要点卡。从想法到成课，只差一句话。
              </p>
            </div>
            <span className="mt-6 inline-flex items-center gap-1 text-[13px] font-bold text-white">
              去造一门课
              <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          {/* 侧引擎：资料升维 + AI 伴侣（纵列，主卡浅材质 + 内高光） */}
          <div className="flex flex-col gap-4">
            {[
              {
                Icon: Waveform,
                title: "资料升维",
                desc: "文档、笔记、任何资料丢进来，升维成带章节、测验、AI 伴侣的一门课。",
                href: "/create",
                cta: "导入资料",
              },
              {
                Icon: Microphone,
                title: "AI 学习伴侣",
                desc: "学到哪问到哪。伴侣读完你的整门课，随时答疑、带你复盘。",
                href: "/courses",
                cta: "看看课程",
              },
            ].map((e, i) => (
              <Link
                key={e.title}
                href={e.href}
                style={{ "--i": i + 1, boxShadow: "var(--card), var(--inner-hi)" } as React.CSSProperties}
                className="studio-lift group flex flex-1 flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5"
              >
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-[var(--red-soft)] text-[var(--red)]">
                  <e.Icon size={19} weight="fill" />
                </div>
                <h3 className="mt-3.5 text-[15px] font-bold text-[var(--ink)]">{e.title}</h3>
                <p className="mt-1.5 flex-1 text-[13px] leading-[1.7] text-[var(--ink2)]">{e.desc}</p>
                {/* 卡内已有 red-soft 图标承接品牌色，CTA 文字用中性墨、hover 转红，避免同卡双红 */}
                <span className="mt-3.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink2)] transition-colors group-hover:text-[var(--red)]">
                  {e.cta}
                  <ArrowRight
                    size={12}
                    weight="bold"
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 1.6 学习闭环 学·记·复习·共创（横向节奏 + 功能色语义） ============ */}
      <section>
        <Reveal>
          <div
            className="relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] p-6 sm:p-7"
            style={{ boxShadow: "var(--inner-hi)" }}
          >
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-bold tracking-[-0.01em] text-[var(--ink)]">一张书桌，装下完整的学习闭环</h2>
              </div>
              <p className="text-[12px] leading-[1.6] text-[var(--ink3)]">看 → 记 → 复习 → 共创，四步不离桌</p>
            </div>
            {/* 四步 stagger 递延进场；每步用功能色语义（记=info、复习=warn、完成=ok） */}
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: "01",
                  Icon: Play,
                  title: "边看边学",
                  desc: "视频与课件在同一张桌面",
                  tint: "var(--red)",
                  soft: "var(--red-soft)",
                },
                {
                  step: "02",
                  Icon: NotePencil,
                  title: "随手成笔记",
                  desc: "截帧、划线、AI 整理",
                  tint: "var(--info)",
                  soft: "var(--info-soft)",
                },
                {
                  step: "03",
                  Icon: ClockCounterClockwise,
                  title: "到点复习",
                  desc: "间隔重复，把知识记牢",
                  tint: "var(--warn)",
                  soft: "var(--warn-soft)",
                },
                {
                  step: "04",
                  Icon: UsersThree,
                  title: "共创下一门",
                  desc: "投票决定平台造什么课",
                  tint: "var(--ok)",
                  soft: "var(--ok-soft)",
                },
              ].map((s, i) => (
                <div
                  key={s.step}
                  style={{ "--i": i } as React.CSSProperties}
                  className="studio-lift group relative flex flex-col rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px]"
                      style={{ background: s.soft, color: s.tint }}
                    >
                      <s.Icon size={17} weight="fill" />
                    </div>
                    <span className="mono text-[11px] font-bold" style={{ color: s.tint }}>
                      {s.step}
                    </span>
                  </div>
                  <p className="mt-3 text-[14px] font-bold text-[var(--ink)]">{s.title}</p>
                  <p className="mt-1 text-[12px] leading-[1.6] text-[var(--ink3)]">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============ 2. 课程赛道 赛道渐变封面 grid ============ */}
      <section>
        <Reveal>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink3)]">TRACKS</p>
              <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-[var(--ink)]">课程赛道</h2>
            </div>
            <Link
              href="/courses"
              className="group inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--red)]"
            >
              全部赛道
              <ArrowRight
                size={14}
                weight="bold"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </Reveal>
        {/* stagger 递延进场；每卡赛道渐变封面（--track-*） */}
        <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
          {trackLines.map((l, i) => (
            <TrackCard key={l.track.key} line={l} index={i} />
          ))}
        </div>
      </section>

      {/* ============ 3. 共创 + 订阅 teaser（非对称双卡） ============ */}
      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* 共创卡（L1 主卡 + 内高光） */}
        <div
          className="studio-lift flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6"
          style={{ boxShadow: "var(--card), var(--inner-hi)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-bold tracking-[-0.01em] text-[var(--ink)]">共创广场</h2>
            </div>
            <Link
              href="/demands"
              className="group inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--red)]"
            >
              你想学的，投票决定
              <ArrowRight
                size={14}
                weight="bold"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          {topDemand ? (
            <div className="mt-5 flex items-center gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/demands/${topDemand.id}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--ink)] hover:text-[var(--red)]">
                    {topDemand.title}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ok)]/25 bg-[var(--ok-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--ok)]">
                    <CheckCircle size={12} weight="fill" />
                    {topDemand.categoryLabel} · 已进入排期
                  </span>
                </Link>
                {topDemand.description && (
                  <p className="mt-1 line-clamp-1 text-[13px] text-[var(--ink3)]">
                    {topDemand.description}
                  </p>
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
            /* 空态：有设计感的构图（图形 + 引导 + CTA），非灰图标一句话 */
            <div className="mt-5 flex flex-col items-center rounded-[14px] border border-dashed border-[var(--border2)] bg-[var(--surface2)] px-4 py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-[var(--red-soft)] text-[var(--red)]">
                <UsersThree size={22} weight="fill" />
              </div>
              <p className="mt-3 text-[14px] font-semibold text-[var(--ink)]">还没有共创需求</p>
              <p className="mt-1 max-w-[240px] text-[12px] leading-[1.6] text-[var(--ink3)]">
                你最想学什么？发起第一条，让平台为你造课。
              </p>
              <Link
                href="/demands"
                className="cta-glow studio-press mt-4 inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white"
              >
                <Sparkle size={13} weight="fill" />
                发起需求
              </Link>
            </div>
          )}

          <Link
            href="/demands"
            className="mono mt-4 inline-flex items-center gap-1.5 text-[11px] text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
          >
            <UsersThree size={13} />
            共 <span className="font-bold text-[var(--ink2)]">{demands.length}</span> 条在征集 · 每周排期一次
          </Link>
        </div>

        {/* 订阅卡（深色展示区：video-grad 渐变 + 柔光装饰，非死黑平面） */}
        <div
          className="hover-sheen studio-lift relative flex flex-col overflow-hidden rounded-[16px] border border-transparent p-6 text-white"
          style={{ background: "var(--video-grad)", boxShadow: "var(--lift)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full"
            style={{ background: "radial-gradient(circle, rgba(252,1,26,0.45), transparent 70%)" }}
          />
          {/* 顶部内高光，加深色区材质 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.06), transparent)" }}
          />
          <div className="relative z-10 flex flex-1 flex-col">
            <h2 className="text-[20px] font-bold tracking-[-0.01em]">年度会员 · 持续更新</h2>
            <p className="mono mt-3 text-[15px] font-bold text-white">
              {yearPlan ? (
                <>
                  ¥{(yearPlan.priceCents / 100).toFixed(0)}
                  <span className="text-[12px] font-normal text-white/60">/年</span>
                </>
              ) : (
                "订阅制"
              )}
              <span className="ml-2 text-[12px] font-normal text-white/60">全部赛道畅学</span>
            </p>
            <p className="mt-2 text-[13px] leading-[1.7] text-white/60">
              停订后笔记与截帧永久保存。随时可取消。
            </p>
            <Link
              href="/pricing"
              className="group mt-auto inline-flex items-center gap-1.5 rounded-[11px] bg-white/12 px-4 py-2.5 pt-2.5 text-[13px] font-bold text-white ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-white/18"
            >
              查看方案
              <ArrowRight
                size={14}
                weight="bold"
                className="transition-transform group-hover:translate-x-0.5"
              />
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

// 赛道封面渐变：按 key 映射到 D1 --track-* token（无硬编码色）。
const TRACK_GRADIENTS: Record<string, string> = {
  english_oral: "var(--track-english)",
  english_foundation: "var(--track-english)",
  silver_english: "var(--track-elder)",
  ai_skill: "var(--track-ai)",
  life: "var(--track-life)",
};

function TrackCard({
  line,
  index,
}: {
  line: { track: import("@/lib/tracks").Track; courses: unknown[]; newCount: number };
  index: number;
}) {
  const { track, courses, newCount } = line;
  const gradient = TRACK_GRADIENTS[track.key] ?? "var(--track-default)";
  return (
    <Link
      href={`/courses?category=${track.key}`}
      style={{ "--i": index, boxShadow: "var(--card), var(--inner-hi)" } as React.CSSProperties}
      className="studio-lift group flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)]"
    >
      {/* 赛道渐变封面（--track-*）+ 顶部内高光 + 图标 + 水印首字，程序化生成、暗色不破相、天然成套 */}
      <div
        className="hover-sheen relative flex h-[92px] items-end overflow-hidden p-[14px]"
        style={{ background: gradient }}
      >
        {/* 顶部斜向高光，避免深色平涂 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.16), transparent 46%)" }}
        />
        {/* 大字水印首字，增加封面叙事层次 */}
        <span className="pointer-events-none absolute -right-1 -top-3 select-none text-[64px] font-black leading-none text-white/[0.10]">
          {track.label.slice(0, 1)}
        </span>
        {/* 左下：赛道图标（品牌标识锚点） */}
        <div className="relative flex h-[36px] w-[36px] items-center justify-center rounded-[11px] bg-white/18 text-white ring-1 ring-white/20 backdrop-blur-sm">
          {TRACK_ICONS[track.key] ?? <Sparkle size={18} weight="fill" />}
        </div>
        {/* NEW 上新徽章（右上角，信号色） */}
        {newCount > 0 && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-[var(--new-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--new-ink)] shadow-[0_1px_4px_rgba(0,0,0,0.25)]">
            {newCount} 节新课
          </span>
        )}
      </div>
      {/* 卡体 */}
      <div className="flex flex-1 flex-col p-[16px]">
        <p className="text-[15px] font-bold text-[var(--ink)]">{track.label}</p>
        <p className="mt-1 text-[12px] leading-[1.5] text-[var(--ink3)]">{track.blurb}</p>
        <div className="mt-auto flex items-center gap-1.5 pt-4">
          {/* 中性库存计数用中性墨色（mono + bold 已足够强调），红只留给真信号 */}
          <span className="mono text-[13px] font-bold text-[var(--ink)]">{courses.length}</span>
          <span className="text-[11px] text-[var(--ink4)]">门课程</span>
          <ArrowRight
            size={13}
            weight="bold"
            className="ml-auto text-[var(--ink4)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--red)]"
          />
        </div>
      </div>
    </Link>
  );
}
