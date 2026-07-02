import Link from "next/link";
import { ArrowRight, Waves, Users, PlayCircle, Broadcast, NotePencil, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { listCourses, listUpdates, listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { CourseCard } from "@/components/CourseCard";
import { VoteButton } from "@/components/VoteButton";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Button, Badge, CoverBg } from "@/components/ui";
import { YoudaoLogo } from "@/components/YoudaoLogo";
import { TidalReveal as Reveal, Stagger, StaggerItem, FlipCounter, Magnetic } from "@/components/motion";
import { TrackView } from "@/components/TrackView";
import { UPDATE_TYPE_LABELS } from "@/lib/format";
import { TRACKS } from "@/lib/tracks";

export default async function HomePage() {
  const user = await getCurrentUser();
  const [all, updates, demands, plans] = await Promise.all([
    listCourses({ sort: "recommended" }),
    listUpdates(8),
    listRankedDemands(["collecting", "evaluating", "scheduled", "producing"]),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
  ]);
  await resolveEntitlement(user?.id ?? null);

  const featured = all.filter((c) => c.isFeatured);
  const hero = featured[0] ?? all[0];
  // 近期有更新日志的课程 → 卡片打 NEW 角标（A3）
  const newSlugs = new Set(updates.map((u) => u.courseSlug));
  const withNew = (c: import("@/components/CourseCard").CourseCardData) => ({ ...c, isNew: newSlugs.has(c.slug) });
  const trackLines = TRACKS.map((t) => ({ track: t, courses: all.filter((c) => c.category === t.key) })).filter((l) => l.courses.length > 0);
  const totalLearners = all.reduce((s, c) => s + c.learnersCount, 0);
  const mainPlans = plans.filter((p) => p.scope === "all" && p.billingPeriod !== "month").slice(0, 2);
  const snapshot = await resolveEntitlement(user?.id ?? null);

  return (
    <div className="space-y-24 md:space-y-32">
      <TrackView event="homepage_view" properties={{ mode: "standard" }} />

      {/* 「本周上新」水位滚动条样式：让 rail 露出 accent 色滚动条作为水位提示 */}
      <style>{`
        .rail-tide { scrollbar-width: thin; scrollbar-color: var(--color-accent-400, #fca5a5) transparent; padding-bottom: 14px; }
        .rail-tide::-webkit-scrollbar { display: block; height: 6px; }
        .rail-tide::-webkit-scrollbar-track { background: var(--color-ink-100, #eef0f0); border-radius: 999px; }
        .rail-tide::-webkit-scrollbar-thumb { background: linear-gradient(90deg, var(--color-accent-300, #fca5a5), var(--color-accent-500, #ef4444)); border-radius: 999px; }
      `}</style>

      {/* ============ 1. HERO — 非对称分栏 ============ */}
      <section className="relative -mx-5 grid gap-10 px-5 pt-6 sm:-mx-8 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-6">
        <div className="relative z-10 max-w-xl">
          <Reveal>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-ink-100 bg-paper-raised px-3 py-1.5">
              <YoudaoLogo variant="red" height={14} />
              <span className="h-3 w-px bg-ink-200" />
              <span className="text-xs font-medium text-ink-500">网易有道 出品</span>
            </div>
          </Reveal>
          <Reveal>
            <div className="overline flex items-center gap-2 text-accent-600">
              <span className="live-dot h-1.5 w-1.5 rounded-full text-accent-600"><span className="block h-1.5 w-1.5 rounded-full bg-accent-600" /></span>
              订阅制 · 持续更新 · 用户共创
            </div>
          </Reveal>
          <Reveal delay={0.06}>
            <h1 className="mt-5 text-[2.35rem] font-semibold leading-[1.08] tracking-tight text-ink-950 sm:text-[3.1rem]">
              订阅一次，
              <br />
              学不完的<span className="relative whitespace-nowrap text-accent-700">持续更新<span className="absolute inset-x-0 -bottom-1 h-[3px] rounded-full bg-accent-200" /></span>课程
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-ink-600">
              口语实战、AI 技能、银发英语、生活实用——每周滚动上新。全站畅学或单赛道自由组合，边学边记，投票决定下一门课。
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Magnetic>
                <Button href="/courses" variant="primary" size="lg" icon>免费试学第一章</Button>
              </Magnetic>
              <Button href="/pricing" variant="secondary" size="lg">查看订阅方案</Button>
            </div>
          </Reveal>
          <Reveal delay={0.24}>
            <p className="num mt-6 text-sm text-ink-400">
              已有 <span className="text-ink-700">{totalLearners.toLocaleString()}+</span> 人在学 · 首月 ¥19.9 · 随时可取消
            </p>
          </Reveal>
        </div>

        {/* 右侧：编辑式产品掠影 */}
        <Reveal delay={0.15} y={24}>
          <div className="relative">
            {/* 多层正弦波形（点题「潮汐」）：缓慢相位横移，reduced-motion 下静止 */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[28px]">
              {[
                { fill: "rgba(252,1,26,0.05)", dur: "13s", top: "18%", rev: false },
                { fill: "rgba(252,1,26,0.08)", dur: "9s", top: "34%", rev: true },
                { fill: "rgba(252,1,26,0.12)", dur: "6s", top: "52%", rev: false },
              ].map((w, i) => (
                <svg
                  key={i}
                  className={`absolute left-0 h-[46%] w-[200%] motion-reduce:animate-none`}
                  style={{ top: w.top, animation: `wave-x ${w.dur} linear infinite${w.rev ? " reverse" : ""}` }}
                  viewBox="0 0 1440 160"
                  preserveAspectRatio="none"
                  fill="none"
                >
                  <path d="M0 80 Q180 20 360 80 T720 80 T1080 80 T1440 80 V160 H0 Z" fill={w.fill} />
                </svg>
              ))}
            </div>
            <div className="relative rounded-[28px] border border-ink-100 bg-paper-raised/70 p-5 backdrop-blur-sm">
              {hero && (
                <Link href={`/courses/${hero.slug}`} className="block overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised transition-transform duration-300 hover:-translate-y-1">
                  <CoverBg color={hero.coverColor} className="aspect-[16/9] w-full">
                    <div className="absolute inset-0 flex items-end p-5">
                      <div className="text-white">
                        <span className="rounded-full bg-black/25 px-2.5 py-1 text-[0.7rem] backdrop-blur-sm">{hero.categoryLabel}</span>
                        <p className="mt-2 text-lg font-semibold tracking-tight">{hero.title}</p>
                      </div>
                    </div>
                  </CoverBg>
                </Link>
              )}
              {/* 悬浮信息 chips（A3-2：响应式 2/3 列） */}
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                <FloatChip icon={<Broadcast size={16} weight="fill" className="text-accent-600" />} label="直播小班" sub="真人纠音" />
                <FloatChip icon={<NotePencil size={16} weight="fill" className="text-accent-600" />} label="时间戳笔记" sub="一键回跳" />
                <FloatChip icon={<Sparkle size={16} weight="fill" className="text-accent-600" />} label="需求共创" sub="投票上新" />
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============ 2. 赛道跑马灯 ============ */}
      <section className="marquee -mx-5 overflow-hidden border-y border-ink-100 py-5 sm:-mx-8">
        <div className="marquee-track">
          {[...TRACKS, ...TRACKS, ...TRACKS].map((t, i) => (
            <span key={i} className="mx-6 inline-flex items-center gap-3 text-[1.35rem] font-medium tracking-tight text-ink-300">
              {t.label}
              <Waves size={16} weight="light" className="text-accent-400" />
            </span>
          ))}
        </div>
      </section>

      {/* ============ 3. 本周上新 — 横向 rail ============ */}
      <Section overline="ROLLING" title="本周上新" desc="每门课都有更新日志，这不是死课" href="/updates" linkText="查看全部">
        {/* 滚动水位条：可见的 accent 水位滚动条（原生 thumb = 当前水位）；末尾留白让下一张卡片露出约 20% */}
        <div className="rail rail-tide -mx-5 px-5 pr-[20%] sm:-mx-8 sm:px-8 sm:pr-[15%]">
          {updates.map((u, i) => (
            <Reveal key={u.id} delay={i * 0.04}>
              <Link href={`/courses/${u.courseSlug}`} className="block w-[280px] rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent-200">
                <div className="flex items-center justify-between">
                  <Badge tone="success">{UPDATE_TYPE_LABELS[u.updateType]}</Badge>
                  <span className="num text-xs text-ink-400">{u.relativeTime}</span>
                </div>
                <p className="mt-4 font-semibold tracking-tight text-ink-950">{u.courseTitle}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-500">{u.title}</p>
                <p className="num mt-4 border-t border-ink-100 pt-3 text-xs text-ink-400">预计总时长 {u.duration}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ============ 4. 精选 — Bento（1 大 + 2 小，避免三等分）============ */}
      <Section overline="FEATURED" title="精选课程" desc="最值得先学的几门" href="/courses" linkText="全部课程">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 lg:row-span-2">
            {featured[0] && <FeatureLarge course={featured[0]} />}
          </div>
          {featured.slice(1, 3).map((c) => (
            <CourseCard key={c.id} course={withNew(c)} />
          ))}
        </div>
      </Section>

      {/* ============ 5. 内容赛道 — zig-zag ============ */}
      <div className="space-y-20">
        {trackLines.map((l, i) => (
          <Reveal key={l.track.key}>
            <div className={`grid gap-6 lg:grid-cols-[0.8fr_2.2fr] lg:items-center ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}>
              <div className={i % 2 === 1 ? "lg:pl-8 lg:text-right" : ""}>
                <div className="overline text-accent-600">TRACK</div>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">{l.track.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{l.track.people} · {l.track.blurb}</p>
              </div>
              <div className="rail">
                {l.courses.map((c) => (
                  <div key={c.id} className="w-[300px]"><CourseCard course={withNew(c)} /></div>
                ))}
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* ============ 6. 需求榜 — 编辑式榜单（分隔线，不装盒）============ */}
      <Section overline="CO-CREATE" title="需求排行榜" desc="你投票，决定平台下一批课程" href="/demands" linkText="进入共创">
        <Stagger className="divide-y divide-ink-100 border-y border-ink-100">
          {demands.slice(0, 5).map((d, i) => (
            <StaggerItem key={d.id}>
              <div className="flex items-center gap-5 py-5">
                <span className={`num w-8 shrink-0 text-lg ${i === 0 ? "text-accent-600" : "text-ink-300"}`}>{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/demands/${d.id}`} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-950 hover:text-accent-700">{d.title}</span>
                    <Badge tone="muted">{d.categoryLabel}</Badge>
                  </Link>
                  {d.description && <p className="mt-1 line-clamp-1 text-sm text-ink-500">{d.description}</p>}
                </div>
                <VoteButton demandId={d.id} initialVotes={d.totalVotes} canVote={snapshot.canVote} disabledReason={snapshot.canVote ? undefined : "订阅后可投票"} />
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Section>

      {/* ============ 7. 学习+笔记 演示 — 分栏 ============ */}
      <Reveal>
        <section className="grid items-center gap-10 rounded-[28px] border border-ink-100 bg-paper-raised p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <div className="overline text-accent-600">NOTES</div>
            <h2 className="mt-3 text-[1.75rem] font-semibold tracking-tight text-ink-950">边学边记，笔记带时间戳</h2>
            <p className="mt-4 leading-relaxed text-ink-600">
              记笔记不打断视频。每条笔记自动绑定课程、章节与时间戳，下次点一下就回到视频对应位置。停订后笔记仍可查看和导出。
            </p>
            <ul className="mt-6 space-y-3">
              {["时间戳锚点，一键回跳", "按课程归档、全文搜索", "笔记永久保留，属于你自己"].map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-sm text-ink-700">
                  <ArrowRight size={15} weight="bold" className="text-accent-600" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-7"><Button href="/notes" variant="secondary">查看我的笔记</Button></div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper p-5">
            <div className="mb-3 aspect-video overflow-hidden rounded-xl" style={{ background: "linear-gradient(140deg,#2a0a0d,#fc011a)" }}>
              <div className="flex h-full items-center justify-center">
                <PlayCircle size={44} weight="fill" className="text-white/90" />
              </div>
            </div>
            <div className="rounded-lg border border-ink-100 bg-paper-raised p-3.5">
              <span className="num inline-block rounded bg-accent-50 px-2 py-0.5 text-xs text-accent-700">03:00</span>
              <p className="mt-2 text-sm text-ink-700">关键点：把 AI 当协作者，先给背景再提要求。</p>
            </div>
          </div>
        </section>
      </Reveal>

      {/* ============ 8. 数据条 — 分隔线，不装盒 ============ */}
      <section className="grid gap-8 border-y border-ink-100 py-12 sm:grid-cols-3 sm:divide-x sm:divide-ink-100">
        <Stat value={all.length} label="门体系化课程" />
        <Stat value={totalLearners} label="累计学习人次" suffix="+" />
        <StatText value={`${TRACKS.length} 条`} label="在售赛道 · 每周上新" />
      </section>

      {/* ============ 9. 订阅 ============ */}
      <Section overline="PRICING" title="按需订阅，自由组合" desc="全站畅学，或只订你要的赛道" center>
        <div className="mx-auto grid max-w-2xl gap-6 sm:grid-cols-2">
          {mainPlans.map((p) => (
            <SubscriptionCard key={p.id} plan={p} isLoggedIn={!!user} redirectTo="/me/subscription" />
          ))}
        </div>
        <p className="mt-5 text-center text-sm text-ink-400">
          还有单赛道月卡低门槛切入 · <Link href="/pricing" className="link-underline text-accent-700">查看完整方案</Link>
        </p>
      </Section>

      {/* ============ 10. FAQ ============ */}
      <Section overline="FAQ" title="常见问题" center>
        <div className="mx-auto max-w-2xl divide-y divide-ink-100 border-y border-ink-100">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink-950">
                {f.q}
                <span className="text-ink-300 transition-transform duration-300 group-open:rotate-45"><ArrowRight size={18} className="rotate-45" /></span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}

const FAQ = [
  { q: "订阅后可以学哪些课程？", a: "全站会员解锁全部赛道；单赛道会员解锁所订赛道，含每周上新的新章节。停订后课程锁定，但笔记永久保留。" },
  { q: "怎么取消订阅？", a: "在「我的 · 订阅管理」中随时可取消，取消入口清晰可见。取消后权益保留到当前周期结束，不会二次扣费。" },
  { q: "需求投票真的有用吗？", a: "有。订阅用户每周有 5 票，投票进入综合排行榜，与投流数据一起决定课程排期。需求上线后，投过票的用户会收到通知。" },
  { q: "健康类课程靠谱吗？", a: "健康内容仅用于健康信息素养学习，不构成诊断、治疗或用药建议，且必须经审核人审核并标注免责声明。" },
];

/* ---------- 局部组件 ---------- */
function Section({ overline, title, desc, href, linkText, center, children }: { overline?: string; title: string; desc?: string; href?: string; linkText?: string; center?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <Reveal>
        <div className={`mb-8 flex items-end justify-between gap-4 ${center ? "flex-col items-center text-center" : ""}`}>
          <div>
            {overline && <div className="overline mb-2 text-accent-600">{overline}</div>}
            <h2 className="text-[1.75rem] font-semibold tracking-tight text-ink-950">{title}</h2>
            {desc && <p className="mt-2 text-ink-500">{desc}</p>}
          </div>
          {href && linkText && !center && (
            <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent-700">
              {linkText}
              <ArrowRight size={15} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </Reveal>
      {children}
    </section>
  );
}

function FloatChip({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-paper-raised p-3">
      {icon}
      <p className="mt-2 text-xs font-medium text-ink-950">{label}</p>
      <p className="text-[0.68rem] text-ink-400">{sub}</p>
    </div>
  );
}

function FeatureLarge({ course }: { course: import("@/components/CourseCard").CourseCardData }) {
  return (
    <Link href={`/courses/${course.slug}`} className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-ink-100 bg-paper-raised transition-all duration-300 [transition-timing-function:var(--ease-out-expo)] hover:-translate-y-1 hover:border-accent-200 hover:shadow-[0_32px_64px_-32px_rgba(13,51,45,0.3)]">
      <CoverBg color={course.coverColor} className="aspect-[16/9] w-full lg:aspect-[16/8]">
        <div className="absolute left-4 top-4"><span className="rounded-full bg-black/25 px-3 py-1 text-xs text-white backdrop-blur-sm">{course.categoryLabel}</span></div>
      </CoverBg>
      <div className="flex flex-1 flex-col p-6">
        <div className="overline flex items-center gap-2 text-ink-400"><span>{course.levelLabel}</span><span className="h-3 w-px bg-ink-200" /><span>{course.duration}</span></div>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-ink-950 group-hover:text-accent-700">{course.title}</h3>
        {course.subtitle && <p className="mt-1.5 text-ink-500">{course.subtitle}</p>}
        <div className="num mt-auto flex items-center gap-2 pt-4 text-sm text-accent-700">
          {course.updateText}
          <span className="ml-auto flex items-center gap-1 text-ink-400"><Users size={14} />{course.learnersCount.toLocaleString()}</span>
        </div>
      </div>
    </Link>
  );
}

function Stat({ value, label, suffix }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="text-center sm:px-4">
      <div className="num flex items-baseline justify-center text-4xl font-semibold tracking-tight text-ink-950">
        <FlipCounter value={value} />
        {suffix && <span>{suffix}</span>}
      </div>
      <div className="mt-2 text-sm text-ink-500">{label}</div>
    </div>
  );
}
function StatText({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center sm:px-4">
      <div className="text-4xl font-semibold tracking-tight text-ink-950">{value}</div>
      <div className="mt-2 text-sm text-ink-500">{label}</div>
    </div>
  );
}
