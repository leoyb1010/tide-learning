import Link from "next/link";
import { listCourses, listUpdates, listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { CourseCard } from "@/components/CourseCard";
import { DemandCard } from "@/components/DemandCard";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Button, Badge } from "@/components/ui";
import { TrackView } from "@/components/TrackView";
import { UPDATE_TYPE_LABELS } from "@/lib/format";
import { TRACKS } from "@/lib/tracks";

export default async function HomePage() {
  const user = await getCurrentUser();
  const [all, updates, demands, plans, snapshot] = await Promise.all([
    listCourses({ sort: "recommended" }),
    listUpdates(8),
    listRankedDemands(["collecting", "evaluating", "scheduled", "producing"]),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    resolveEntitlement(user?.id ?? null),
  ]);

  const featured = all.filter((c) => c.isFeatured).slice(0, 6);
  const popular = [...all].sort((a, b) => b.learnersCount - a.learnersCount).slice(0, 3);
  // 按赛道分组（融合有道内容板块）
  const trackLines = TRACKS.map((t) => ({ track: t, courses: all.filter((c) => c.category === t.key).slice(0, 3) })).filter((l) => l.courses.length > 0);
  const totalLearners = all.reduce((s, c) => s + c.learnersCount, 0);
  // 全站会员主推：连续包月 + 年卡
  const mainPlans = plans.filter((p) => p.scope === "all" && p.billingPeriod !== "month").slice(0, 2);

  return (
    <div className="space-y-20">
      <TrackView event="homepage_view" properties={{ mode: "standard" }} />

      {/* 1. Hero */}
      <section className="relative -mx-4 overflow-hidden rounded-b-3xl px-4 pb-16 pt-10 sm:-mx-6 sm:px-6">
        <div className="hero-gradient absolute inset-0 -z-10 opacity-70" />
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="tide">订阅制 · 持续更新 · 用户共创</Badge>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-ink-950 sm:text-5xl">
            订阅一次，
            <br className="sm:hidden" />
            学不完的持续更新课程
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-800 sm:text-lg">
            AI 实用技能、雅思备考、生活实用课，每周滚动上新。
            你投票，我们上新；边学边记，笔记永远属于你。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/courses" variant="primary" size="lg">免费试学第一章</Button>
            <Button href="/pricing" variant="secondary" size="lg">查看订阅方案</Button>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            已有 {totalLearners.toLocaleString()}+ 人在学 · 首月 ¥19 · 随时可取消
          </p>
        </div>
      </section>

      {/* 2. 本周上新 */}
      <Section title="本周上新" subtitle="每门课都有更新日志，这不是死课" href="/updates" linkText="查看全部">
        <div className="scroll-row">
          {updates.map((u) => (
            <Link key={u.id} href={`/courses/${u.courseSlug}`} className="w-[260px] rounded-2xl border border-ink-100 bg-paper-raised p-4 transition-shadow hover:shadow-[var(--shadow-soft)]">
              <div className="mb-3 flex items-center gap-2">
                <Badge tone="success">{UPDATE_TYPE_LABELS[u.updateType]}</Badge>
                <span className="text-xs text-ink-400">{u.relativeTime}</span>
              </div>
              <p className="font-medium text-ink-950">{u.courseTitle}</p>
              <p className="mt-1 line-clamp-2 text-sm text-ink-500">{u.title}</p>
              <p className="mt-3 text-xs text-ink-400">预计总时长 {u.duration}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* 3. 热门课程 */}
      <Section title="热门课程" subtitle="最多人在学的体系化课程" href="/courses" linkText="全部课程">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {popular.map((c) => <CourseCard key={c.id} course={c} />)}
        </div>
      </Section>

      {/* 4. 内容赛道（融合有道内容板块） */}
      <section className="space-y-10">
        {trackLines.map((l) => (
          <ContentLine key={l.track.key} title={l.track.label} hint={`${l.track.people} · ${l.track.blurb}`} courses={l.courses} />
        ))}
      </section>

      {/* 5. 需求排行榜预览 */}
      <Section title="需求排行榜" subtitle="你投票，决定平台下一批课程" href="/demands" linkText="进入共创">
        <div className="space-y-3">
          {demands.slice(0, 5).map((d, i) => (
            <DemandCard
              key={d.id}
              demand={d}
              rank={i + 1}
              canVote={snapshot.canVote}
              disabledReason={snapshot.canVote ? undefined : "订阅后可投票"}
            />
          ))}
        </div>
      </Section>

      {/* 6. 学习 + 笔记演示 */}
      <section className="grid items-center gap-8 rounded-3xl border border-ink-100 bg-paper-raised p-8 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold text-ink-950">边学边记，笔记带时间戳</h2>
          <p className="mt-3 leading-relaxed text-ink-500">
            记笔记不打断视频。每条笔记自动绑定课程、章节和时间戳，
            下次点一下就回到视频对应位置。停订后笔记仍然可以查看和导出。
          </p>
          <ul className="mt-5 space-y-2 text-sm text-ink-800">
            <li>✓ 时间戳锚点，一键回跳</li>
            <li>✓ 按课程归档、全文搜索</li>
            <li>✓ 笔记永久保留，属于你自己</li>
          </ul>
          <div className="mt-6"><Button href="/notes" variant="secondary">查看我的笔记</Button></div>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-[var(--shadow-soft)]">
          <div className="mb-3 aspect-video rounded-xl" style={{ background: "linear-gradient(135deg,#1f7a70,#4d9d95)" }} />
          <div className="space-y-2">
            <div className="rounded-lg border border-ink-100 p-3">
              <span className="rounded bg-tide-50 px-2 py-0.5 text-xs text-tide-700">⏱ 3:00</span>
              <p className="mt-1.5 text-sm text-ink-800">关键点：把 AI 当协作者，先给背景再提要求。</p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. 数据证明 */}
      <section className="grid gap-6 rounded-3xl bg-tide-600 px-8 py-12 text-center text-white sm:grid-cols-3">
        <Stat value={`${all.length}`} label="门体系化课程" />
        <Stat value={`${totalLearners.toLocaleString()}+`} label="累计学习人次" />
        <Stat value="每周" label="滚动上新节奏" />
      </section>

      {/* 8. 订阅方案 */}
      <Section title="订阅方案" subtitle="一次订阅，解锁全站课程" center>
        <div className="mx-auto grid max-w-2xl gap-5 sm:grid-cols-2">
          {mainPlans.map((p) => (
            <SubscriptionCard key={p.id} plan={p} isLoggedIn={!!user} redirectTo="/me/subscription" />
          ))}
        </div>
        <p className="mt-4 text-center text-sm text-ink-400">
          还有单月套餐作为价格参考 · <Link href="/pricing" className="text-tide-700 hover:underline">查看完整方案</Link>
        </p>
      </Section>

      {/* 9. FAQ */}
      <Section title="常见问题" center>
        <div className="mx-auto max-w-2xl divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-paper-raised">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink-950">
                {f.q}
                <span className="text-ink-400 transition-transform group-open:rotate-45">＋</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}

const FAQ = [
  { q: "订阅后可以学哪些课程？", a: "订阅后解锁全站所有课程，包含每周上新的新章节。停订后课程锁定，但你的笔记永久保留。" },
  { q: "怎么取消订阅？", a: "在「我的-订阅管理」中随时可取消，取消入口清晰可见。取消后权益保留到当前周期结束，不会二次扣费。" },
  { q: "需求投票真的有用吗？", a: "有。订阅用户每周有 5 票，投票进入综合排行榜，影响课程排期。需求上线后，投过票的用户会收到通知。" },
  { q: "健康类课程靠谱吗？", a: "健康类内容仅用于健康信息素养学习，不构成诊断、治疗或用药建议，且必须经过审核人审核并标注免责声明。" },
];

function Section({ title, subtitle, href, linkText, center, children }: { title: string; subtitle?: string; href?: string; linkText?: string; center?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className={`mb-6 flex items-end justify-between ${center ? "flex-col items-center text-center" : ""}`}>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink-950">{title}</h2>
          {subtitle && <p className="mt-1.5 text-ink-500">{subtitle}</p>}
        </div>
        {href && linkText && !center && <Link href={href} className="shrink-0 text-sm font-medium text-tide-700 hover:underline">{linkText} →</Link>}
      </div>
      {children}
    </section>
  );
}

function ContentLine({ title, hint, courses }: { title: string; hint: string; courses: Awaited<ReturnType<typeof listCourses>> }) {
  if (courses.length === 0) return null;
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="text-lg font-semibold text-ink-950">{title}</h3>
        <span className="text-sm text-ink-400">{hint}</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((c) => <CourseCard key={c.id} course={c} />)}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular sm:text-4xl">{value}</div>
      <div className="mt-1 text-sm text-white/80">{label}</div>
    </div>
  );
}
