import { prisma } from "@/lib/db";
import { CHANNEL_LABELS } from "@/lib/format";
import { trackLabel, TRACKS } from "@/lib/tracks";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "数据看板" };

// §8.2.5 运营数据看板：P1 十项指标
export default async function AdminDashboard() {
  // 页面级权限门（P0-1）：与 /api/admin/dashboard 的 requirePermission("dashboard:read") 对齐。
  await requireAdminPage("dashboard:read", "/admin");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const premiumStatuses = ["active", "trial", "grace_period", "canceled_but_active"];

  const [views, registrationEvents, trials, activeSubs, weeklyLearners, notes, demands, votesAgg, refunds, checkouts, leads, viewEvents, subsForScope, premiumCourses, premiumHits, deterministicHits, rejectGroups, recentRendered, funnelGroups] = await Promise.all([
    prisma.analyticsEvent.count({ where: { eventName: "homepage_view" } }),
    prisma.analyticsEvent.findMany({ where: { eventName: "signup_success", userId: { not: null } }, distinct: ["userId"], select: { userId: true } }),
    prisma.analyticsEvent.count({ where: { eventName: "lesson_trial_start" } }),
    prisma.subscription.findMany({ where: { status: { in: premiumStatuses } }, distinct: ["userId"], select: { userId: true } }),
    prisma.learningProgress.findMany({ where: { lastPlayedAt: { gte: weekAgo } }, distinct: ["userId"], select: { userId: true } }),
    prisma.note.count({ where: { deletedAt: null } }),
    prisma.demand.count(),
    prisma.demandVote.aggregate({ _sum: { voteCount: true } }),
    prisma.order.count({ where: { status: "refunded" } }),
    prisma.analyticsEvent.count({ where: { eventName: "checkout_start" } }),
    prisma.lead.findMany({ select: { source: true, status: true } }),
    prisma.analyticsEvent.findMany({ where: { eventName: "homepage_view" }, select: { propertiesJson: true } }),
    prisma.subscription.findMany({ where: { status: { in: premiumStatuses } }, select: { userId: true, scope: true } }),
    prisma.course.count({ where: { qualityTier: "premium" } }),
    prisma.lesson.count({ where: { renderEngine: "llm" } }),
    prisma.lesson.count({ where: { renderEngine: "deterministic" } }),
    prisma.lesson.groupBy({ by: ["renderRejectReason"], where: { renderRejectReason: { not: null } }, _count: true, orderBy: { _count: { renderRejectReason: "desc" } }, take: 5 }),
    prisma.lesson.findMany({ where: { renderEngine: { not: null } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, renderEngine: true, renderRejectReason: true, renderDurationMs: true, course: { select: { title: true, template: true, qualityTier: true } } } }),
    prisma.analyticsEvent.groupBy({
      by: ["eventName"],
      where: { eventName: { in: ["homepage_view", "course_card_click", "lesson_trial_start", "signup_success", "paywall_view", "checkout_start", "subscription_success", "lesson_continue_after_pay"] } },
      _count: true,
    }),
  ]);

  // 渠道漏斗：曝光(埋点 source) → 留资(lead) → 转化(lead converted)
  const channelViews: Record<string, number> = {};
  for (const e of viewEvents) {
    try { const s = JSON.parse(e.propertiesJson).source; if (s) channelViews[s] = (channelViews[s] ?? 0) + 1; } catch { /* skip */ }
  }
  const channelStats: Record<string, { views: number; leads: number; converted: number }> = {};
  for (const src of new Set([...Object.keys(channelViews), ...leads.map((l) => l.source)])) {
    channelStats[src] = {
      views: channelViews[src] ?? 0,
      leads: leads.filter((l) => l.source === src).length,
      converted: leads.filter((l) => l.source === src && l.status === "converted").length,
    };
  }
  // 分赛道订阅分布（人群/赛道维度）
  const scopeUsers = new Map<string, Set<string>>();
  for (const sub of subsForScope) {
    const users = scopeUsers.get(sub.scope) ?? new Set<string>();
    users.add(sub.userId);
    scopeUsers.set(sub.scope, users);
  }
  const scopeCounts = [...scopeUsers].map(([scope, users]) => ({ scope, count: users.size }));

  const activeSubscriberIds = new Set(activeSubs.map((s) => s.userId));
  const subs = activeSubscriberIds.size;
  const registeredIds = new Set(registrationEvents.flatMap((e) => e.userId ? [e.userId] : []));
  const registers = registeredIds.size;
  const convertedRegistered = [...registeredIds].filter((id) => activeSubscriberIds.has(id)).length;
  const weeklyActivePaidLearners = new Set(weeklyLearners.filter((p) => activeSubscriberIds.has(p.userId)).map((p) => p.userId)).size;
  const convRate = registers > 0 ? ((convertedRegistered / registers) * 100).toFixed(1) : "0";
  const funnelCounts = new Map(funnelGroups.map((g) => [g.eventName, g._count]));
  const funnel = ["homepage_view", "course_card_click", "lesson_trial_start", "signup_success", "paywall_view", "checkout_start", "subscription_success", "lesson_continue_after_pay"];

  const cards = [
    { label: "访问（首页曝光）", value: views },
    { label: "完成注册（可识别用户）", value: registers },
    { label: "试学次数", value: trials },
    { label: "有效订阅用户", value: subs },
    { label: "注册同期群→当前有效订阅", value: `${convRate}%` },
    { label: "近 7 天付费学习用户", value: weeklyActivePaidLearners },
    { label: "笔记创建", value: notes },
    { label: "需求提交", value: demands },
    { label: "投票数", value: votesAgg._sum.voteCount ?? 0 },
    { label: "退款数", value: refunds },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">数据看板</h1>
        <p className="mt-1 text-sm text-ink-400">北极星指标：近 7 天有真实进度写入的有效订阅用户 · 发起支付 {checkouts} 次</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-ink-100 bg-paper-raised p-4">
            <div className="text-2xl font-semibold text-ink-950 tabular">{c.value}</div>
            <div className="mt-1 text-xs text-ink-400">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <h2 className="mb-3 font-medium text-ink-950">P1 核心漏斗</h2>
        <div className="flex flex-wrap gap-2 text-sm text-ink-500">
          {funnel.map((name, index) => <span key={name}>{index > 0 && "→ "}{name} <strong className="tabular text-ink-950">{funnelCounts.get(name) ?? 0}</strong></span>)}
        </div>
        <p className="mt-2 text-xs text-ink-400">以上为 analytics_events 实际记录数；0 表示尚未观测到该事件，不代表链路已完成。</p>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-medium text-ink-950">高级课件渲染</h2><p className="mt-1 text-xs text-ink-400">premium 命中、确定性回落与拒绝原因</p></div>
          <div className="text-sm text-ink-500">精修课程 {premiumCourses} 门 · bespoke 命中率 {premiumHits + deterministicHits > 0 ? ((premiumHits / (premiumHits + deterministicHits)) * 100).toFixed(1) : "0"}%</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-ink-50 p-3"><div className="text-xl font-semibold tabular text-ink-950">{premiumHits}</div><div className="text-xs text-ink-400">bespoke 章节</div></div>
          <div className="rounded-xl bg-ink-50 p-3"><div className="text-xl font-semibold tabular text-ink-950">{deterministicHits}</div><div className="text-xs text-ink-400">确定性/回落</div></div>
          <div className="rounded-xl bg-ink-50 p-3"><div className="text-xl font-semibold tabular text-ink-950">{rejectGroups.reduce((n, g) => n + g._count, 0)}</div><div className="text-xs text-ink-400">拒绝记录</div></div>
        </div>
        {rejectGroups.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{rejectGroups.map((g) => <span key={g.renderRejectReason} className="rounded-full border border-ink-100 px-3 py-1 text-xs text-ink-500">{g.renderRejectReason} · {g._count}</span>)}</div>}
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-ink-100 text-left text-ink-400"><tr><th className="py-2 pr-3">课程 / 章节</th><th className="py-2 pr-3">模板</th><th className="py-2 pr-3">引擎</th><th className="py-2">耗时</th></tr></thead><tbody className="divide-y divide-ink-100">{recentRendered.map((l) => <tr key={l.id}><td className="py-2.5 pr-3"><div className="font-medium text-ink-950">{l.course.title}</div><div className="text-xs text-ink-400">{l.title}</div></td><td className="py-2.5 pr-3 text-ink-500">{l.course.template ?? "classic"}</td><td className="py-2.5 pr-3 text-ink-500">{l.renderEngine}</td><td className="py-2.5 text-ink-500">{l.renderDurationMs ?? 0}ms</td></tr>)}</tbody></table></div>
      </div>

      {/* 渠道漏斗（融合有道端内/端外流量结构） */}
      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <h2 className="mb-3 font-medium text-ink-950">渠道漏斗：曝光 → 留资 → 转化</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 text-left text-ink-400">
              <tr><th className="py-2 pr-4">渠道</th><th className="py-2 pr-4">曝光</th><th className="py-2 pr-4">留资</th><th className="py-2 pr-4">转化</th><th className="py-2">留资转化率</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {Object.entries(channelStats).map(([src, s]) => (
                <tr key={src}>
                  <td className="py-2.5 pr-4 font-medium text-ink-950">{CHANNEL_LABELS[src] ?? src}</td>
                  <td className="py-2.5 pr-4 tabular">{s.views}</td>
                  <td className="py-2.5 pr-4 tabular">{s.leads}</td>
                  <td className="py-2.5 pr-4 tabular text-success">{s.converted}</td>
                  <td className="py-2.5 tabular text-accent-700">{s.leads ? ((s.converted / s.leads) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分赛道订阅分布（人群/赛道维度） */}
      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <h2 className="mb-3 font-medium text-ink-950">分赛道订阅分布</h2>
        <div className="flex flex-wrap gap-3">
          {scopeCounts.length === 0 && <p className="text-sm text-ink-400">暂无订阅</p>}
          {scopeCounts.map((s) => (
            <div key={s.scope} className="rounded-xl border border-ink-100 px-4 py-3">
              <div className="text-lg font-semibold text-ink-950 tabular">{s.count}</div>
              <div className="text-xs text-ink-400">{s.scope === "all" ? "全站会员" : trackLabel(s.scope)}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          共 {TRACKS.length} 条赛道在售 · 分赛道订阅对应有道 2026H2「自由组合订阅」规划。
        </p>
      </div>
    </div>
  );
}
