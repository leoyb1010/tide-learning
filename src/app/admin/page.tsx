import { prisma } from "@/lib/db";

export const metadata = { title: "数据看板" };

// §8.2.5 运营数据看板：P1 十项指标
export default async function AdminDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [views, registers, trials, subs, playAgg, notes, demands, votesAgg, refunds, checkouts] = await Promise.all([
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
  ]);

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
    </div>
  );
}
