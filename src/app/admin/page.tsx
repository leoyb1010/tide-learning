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

  const [views, registers, trials, subs, playAgg, notes, demands, votesAgg, refunds, checkouts, leads, viewEvents, subsByScope] = await Promise.all([
    prisma.analyticsEvent.count({ where: { eventName: "homepage_view" } }),
    prisma.user.count({ where: { role: "user" } }),
    prisma.analyticsEvent.count({ where: { eventName: "lesson_trial_start" } }),
    prisma.subscription.count({ where: { status: { in: ["active", "trial", "grace_period", "canceled_but_active"] } } }),
    prisma.learningProgress.aggregate({ _sum: { progressSec: true } }),
    prisma.note.count({ where: { deletedAt: null } }),
    prisma.demand.count(),
    prisma.demandVote.aggregate({ _sum: { voteCount: true } }),
    prisma.order.count({ where: { status: "refunded" } }),
    prisma.analyticsEvent.count({ where: { eventName: "checkout_start" } }),
    prisma.lead.findMany({ select: { source: true, status: true } }),
    prisma.analyticsEvent.findMany({ where: { eventName: "homepage_view" }, select: { propertiesJson: true } }),
    prisma.subscription.groupBy({ by: ["scope"], where: { status: { in: ["active", "trial", "grace_period", "canceled_but_active"] } }, _count: true }),
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
  const scopeCounts = subsByScope.map((s) => ({ scope: s.scope, count: s._count as unknown as number }));

  const convRate = registers > 0 ? ((subs / registers) * 100).toFixed(1) : "0";
  const playHours = ((playAgg._sum.progressSec ?? 0) / 3600).toFixed(1);

  const cards = [
    { label: "访问（首页曝光）", value: views },
    { label: "注册用户", value: registers },
    { label: "试学次数", value: trials },
    { label: "订阅数", value: subs },
    { label: "注册→订阅转化", value: `${convRate}%` },
    { label: "课程播放时长", value: `${playHours} h` },
    { label: "笔记创建", value: notes },
    { label: "需求提交", value: demands },
    { label: "投票数", value: votesAgg._sum.voteCount ?? 0 },
    { label: "退款数", value: refunds },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">数据看板</h1>
        <p className="mt-1 text-sm text-ink-400">北极星指标：付费订阅用户的周学习时长 · 发起支付 {checkouts} 次</p>
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
        <p className="text-sm text-ink-500">
          homepage_view → course_card_click → lesson_trial_start → signup → paywall_view → checkout_start → subscription_success → lesson_continue_after_pay
        </p>
        <p className="mt-2 text-xs text-ink-400">埋点已全链路上报，事件明细见 analytics_events 表。</p>
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
