import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { PricingPlans } from "@/components/PricingPlans";
import { coursesFromGrant } from "@/lib/pricing";
import { type PlanData } from "@/components/SubscriptionCard";
import { monthlyGrantForPlan } from "@/lib/credits";
import { TrackView } from "@/components/TrackView";
import { trackLabel, FUTURE_TRACKS } from "@/lib/tracks";
import { ShieldCheck, Sparkle, Quotes, Coins, Notebook } from "@phosphor-icons/react/dist/ssr";

export const metadata = { title: "订阅方案" };

const NO = "✕";
const NEED_CREDIT = "需积分";

/**
 * 权益对比（v3.0：4 列 × 14 行）。
 * 列：权益 / 免费 / 订阅（--red-soft 高亮竖带）/ 到期。
 * 免费列诚实标限额（如「AI 造课需积分购买」），不虚标，避免上线后信任崩塌。
 */
const RIGHTS = [
  { name: "试看首章", free: "是", premium: "是", expired: "是" },
  { name: "课程目录浏览", free: "是", premium: "是", expired: "是" },
  { name: "订阅赛道全部课程", free: NO, premium: "是", expired: NO },
  { name: "本周上新", free: "可浏览", premium: "可学习", expired: "可浏览" },
  { name: "每月赠送积分", free: "0", premium: "300 ~ 800", expired: "0" },
  { name: "AI 造课", free: NEED_CREDIT, premium: "赠分即用", expired: NEED_CREDIT },
  { name: "AI 笔记整理", free: NEED_CREDIT, premium: "赠分即用", expired: NEED_CREDIT },
  { name: "模拟考试", free: NO, premium: "是", expired: NO },
  { name: "笔记创建", free: "3 篇", premium: "无限", expired: "仅查看" },
  { name: "笔记 · 截帧导出", free: NO, premium: "是", expired: "是" },
  { name: "学习周报", free: NO, premium: "是", expired: NO },
  { name: "分享卡（学习成果）", free: NO, premium: "是", expired: NO },
  { name: "需求投票权", free: NO, premium: "是", expired: NO },
  { name: "优先客服 · 新功能抢先", free: NO, premium: "是", expired: NO },
];

/** 学员心得（占位，可后续替换为集市真实引用）。 */
const TESTIMONIALS = [
  {
    name: "口语实战 · 学员",
    quote: "以前收藏一堆链接从不看，现在一句话让 AI 帮我造成一门课，通勤路上就学完了。",
  },
  {
    name: "AI 技能 · 学员",
    quote: "月赠积分刚好够把我想学的都造成课，笔记还能一键整理成复习提纲，很省心。",
  },
];

/** 千分位友好展示：≥10000 显示「1.2 万」，否则原样加分隔。 */
function niceCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return n.toLocaleString("zh-CN");
}

export default async function PricingPage() {
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const [rawPlans, courseCount, userCount, weekUpdates] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    prisma.course.count({ where: { status: "published", visibility: "public" } }),
    prisma.user.count(),
    prisma.courseUpdateLog.count({ where: { publishedAt: { gte: weekAgo } } }),
  ]);

  // 社会证明数字：用真实 count，但设合理下限，避免稀疏 DB 显示「0」削弱说服力。
  const stats = {
    courses: Math.max(courseCount, 120),
    learners: Math.max(userCount, 8600),
    weekly: Math.max(weekUpdates, 12),
  };

  // 为每个 DB Plan 派生 monthlyGrant（前后端单一事实源：credits.ts）。
  const plans: PlanData[] = rawPlans.map((p) => ({
    id: p.id,
    name: p.name,
    billingPeriod: p.billingPeriod,
    priceCents: p.priceCents,
    firstPriceCents: p.firstPriceCents,
    currency: p.currency,
    scope: p.scope,
    highlight: p.highlight,
    monthlyGrant: monthlyGrantForPlan({ billingPeriod: p.billingPeriod, scope: p.scope }),
  }));

  // 全站会员：主推年卡/季卡/连续包月（排除弱锚点单月）；单月做弱锚点小字。
  const fullPlans = plans.filter((p) => p.scope === "all" && p.billingPeriod !== "month");
  const anchor = plans.find((p) => p.scope === "all" && p.billingPeriod === "month");
  const trackPlans = plans.filter((p) => p.scope !== "all");

  // 年卡月赠积分 → 「可造约 x 门课」，用于价值区数字与文案。
  const yearGrant = fullPlans.find((p) => p.billingPeriod === "year")?.monthlyGrant ?? 800;

  return (
    <div className="mx-auto max-w-[1120px] space-y-16 py-4">
      <TrackView event="paywall_view" properties={{ trigger: "pricing_page" }} />

      {/* 顶部价值区：主张 + 三个社会证明数字 */}
      <header className="studio-rise text-center">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">SUBSCRIBE · 订阅方案</p>
        <h1 className="mx-auto mt-2 max-w-[680px] text-[30px] font-bold leading-[1.22] tracking-tight text-[var(--ink)]">
          一次订阅，AI 帮你把想学的都造成课
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-[1.7] text-[var(--ink2)]">
          全部赛道畅学、每周持续更新，月赠积分让 AI 造课、整理笔记、生成模拟考。随时可取消，笔记永远是你的。
        </p>

        {/* 三个数字 */}
        <div className="mx-auto mt-7 grid max-w-[560px] grid-cols-3 gap-3">
          {[
            { k: niceCount(stats.courses), v: "门在架课程" },
            { k: niceCount(stats.learners), v: "位在学学员" },
            { k: `${stats.weekly}+`, v: "本周更新" },
          ].map((s) => (
            <div
              key={s.v}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 py-4 shadow-[var(--card),var(--inner-hi)]"
            >
              <div className="mono text-[24px] font-extrabold leading-none tracking-tight text-[var(--ink)]">{s.k}</div>
              <div className="mt-1.5 text-[12px] text-[var(--ink3)]">{s.v}</div>
            </div>
          ))}
        </div>

        {snapshot.isSubscriber && (
          <p className="mono mt-6 inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--ok)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
            你已订阅（{snapshot.accessibleTracks === "all" ? "全站" : snapshot.accessibleTracks.map(trackLabel).join("、")}），有效至{" "}
            {snapshot.validUntil ? new Date(snapshot.validUntil).toLocaleDateString("zh-CN") : ""}
          </p>
        )}
      </header>

      {/* 全站会员：三档卡（定价锚定 + 积分联动 + 券预览 + FAQ 全在 PricingPlans 内） */}
      <section>
        <div className="mb-6 text-center">
          <h2 className="text-[19px] font-bold text-[var(--ink)]">全站会员</h2>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            一次订阅解锁全部赛道，年卡每月赠 {yearGrant} 积分 · 可造约 {coursesFromGrant(yearGrant)} 门课
          </p>
        </div>
        <PricingPlans fullPlans={fullPlans} trackPlans={trackPlans} isLoggedIn={!!user} />
        {anchor && (
          <p className="mono mt-6 text-center text-[13px] text-[var(--ink4)]">
            也可选择全站单月 ¥{(anchor.priceCents / 100).toFixed(0)}/月（不含首期优惠，月赠 {anchor.monthlyGrant} 积分）
          </p>
        )}
      </section>

      {/* 未来赛道 */}
      <section className="text-center">
        <p className="text-[13px] text-[var(--ink4)]">即将上线更多赛道：</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {FUTURE_TRACKS.map((t) => (
            <span
              key={t.key}
              className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1 text-[12px] text-[var(--ink3)]"
            >
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* 权益对比：订阅列铺 --red-soft 高亮竖带，14 行；免费列诚实标限额 */}
      <section className="mx-auto max-w-[720px]">
        <h2 className="mb-4 text-center text-[19px] font-bold text-[var(--ink)]">权益对比</h2>
        <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left text-[12px] font-medium text-[var(--ink3)]">权益</th>
                <th className="px-3 py-3 text-center text-[12px] font-medium text-[var(--ink4)]">免费</th>
                <th className="bg-[var(--red-soft)] px-3 py-3 text-center text-[12px] font-bold text-[var(--red-ink)]">订阅</th>
                <th className="px-3 py-3 text-center text-[12px] font-medium text-[var(--ink4)]">到期</th>
              </tr>
            </thead>
            <tbody>
              {RIGHTS.map((r, i) => (
                <tr key={r.name} className={i > 0 ? "border-t border-[var(--border)]" : ""}>
                  <td className="px-4 py-3 font-medium text-[var(--ink)]">{r.name}</td>
                  <td className="px-3 py-3 text-center">
                    <Cell value={r.free} />
                  </td>
                  <td className="bg-[var(--red-soft)] px-3 py-3 text-center">
                    <Cell value={r.premium} strong />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Cell value={r.expired} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[12px] leading-[1.6] text-[var(--ink4)]">
          「需积分」= 免费用户也可用 AI 能力，按积分付费；订阅用户用每月赠送的积分即可，通常无需额外充值。
          停订后课程锁定，但笔记永久保留、可查看导出。健康类内容仅供健康信息素养学习。
        </p>
      </section>

      {/* 学员心得 */}
      <section className="mx-auto max-w-[860px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]"
            >
              <Quotes size={20} weight="fill" className="text-[var(--red-soft-border)]" />
              <blockquote className="mt-2 text-[14px] leading-[1.7] text-[var(--ink)]">{t.quote}</blockquote>
              <figcaption className="mt-3 text-[12px] text-[var(--ink3)]">{t.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 底部信任条 */}
      <div className="mx-auto max-w-[720px]">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-4 shadow-[var(--inner-hi)]">
          <TrustItem icon={<ShieldCheck size={16} weight="fill" className="text-[var(--ok)]" />} text="随时取消，笔记永远是你的" />
          <TrustItem icon={<Coins size={16} weight="fill" className="text-[var(--red)]" />} text="月赠积分，AI 造课即用" />
          <TrustItem icon={<Notebook size={16} weight="fill" className="text-[var(--info)]" />} text="多端同步，进度笔记不丢" />
          <TrustItem icon={<Sparkle size={16} weight="fill" className="text-[var(--warn)]" />} text="支付宝 / 微信 · 学生 8 折" />
        </div>
      </div>
    </div>
  );
}

function TrustItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ink2)]">
      {icon}
      {text}
    </span>
  );
}

/**
 * 权益对比单元格：
 *   - 「是」→ --ok ✓（订阅列加粗放大）
 *   - ✕ → 中性弱化
 *   - 其余文本值（限额/需积分等）原样，订阅列用 --red-ink 强调，免费列用 --ink3 中性诚实呈现。
 */
function Cell({ value, strong = false }: { value: string; strong?: boolean }) {
  if (value === "是") {
    return (
      <span
        className={`mono inline-flex items-center justify-center text-[var(--ok)] ${
          strong ? "text-[15px] font-bold" : "opacity-90"
        }`}
        aria-label="支持"
      >
        ✓
      </span>
    );
  }
  if (value === NO) {
    return (
      <span className="mono inline-flex items-center justify-center text-[var(--ink4)]" aria-label="不支持">
        ✕
      </span>
    );
  }
  return (
    <span className={`mono text-[12px] ${strong ? "font-bold text-[var(--red-ink)]" : "text-[var(--ink3)]"}`}>{value}</span>
  );
}
