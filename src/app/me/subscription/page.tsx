import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { Badge, Button } from "@/components/ui";
import { CancelSubscription, RestoreButton } from "@/components/AccountActions";
import { yuan, PLAN_PERIOD_LABELS } from "@/lib/format";

export const metadata = { title: "订阅管理" };

export default async function SubscriptionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/subscription");

  const [snapshot, subscription, orders] = await Promise.all([
    resolveEntitlement(user.id),
    prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { currentPeriodEnd: "desc" }, include: { plan: true } }),
    prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { plan: true } }),
  ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;
  const canCancel = ["active", "trial", "grace_period"].includes(snapshot.subscriptionStatus);

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <Link href="/me" className="text-sm text-accent-700 hover:underline">← 我的</Link>
      <h1 className="text-2xl font-semibold text-ink-950">订阅管理</h1>

      {/* 当前状态 */}
      <section className="rounded-2xl border border-ink-100 bg-paper-raised p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-500">当前状态</span>
          <Badge tone={meta.tone === "ok" ? "success" : meta.tone === "warn" ? "warning" : "muted"}>{meta.label}</Badge>
        </div>
        {subscription ? (
          <div className="mt-4 space-y-2 text-sm">
            <Row label="套餐" value={subscription.plan.name} />
            <Row label="周期" value={PLAN_PERIOD_LABELS[subscription.plan.billingPeriod] ?? subscription.plan.billingPeriod} />
            <Row label="有效至" value={new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN")} />
            <Row label="到期后自动续费" value={subscription.cancelAtPeriodEnd ? "否" : "是"} />
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-ink-500">你还没有订阅。订阅后解锁全站课程与投票权益。</p>
            <div className="mt-4"><Button href="/pricing">查看订阅方案</Button></div>
          </div>
        )}

        {snapshot.subscriptionStatus === "billing_retry" && (
          <div className="mt-4 rounded-xl bg-warning/10 p-3 text-sm text-warning">扣款失败，请更新支付方式后重试。</div>
        )}

        {/* 取消 / 恢复（§6.7） */}
        <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4">
          <RestoreButton />
          {canCancel && <CancelSubscription />}
        </div>
      </section>

      <p className="rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-700">
        取消订阅后：课程锁定，但笔记永久保留、可继续查看和导出。这是我们的承诺。
      </p>

      {/* 订单记录 */}
      <section>
        <h2 className="mb-3 font-medium text-ink-950">订单记录</h2>
        {orders.length === 0 ? (
          <p className="rounded-xl border border-ink-100 bg-paper-raised p-4 text-sm text-ink-400">暂无订单</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-ink-100">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-950">{o.plan.name}</p>
                      <p className="text-xs text-ink-400">{new Date(o.createdAt).toLocaleString("zh-CN")} · {o.channel}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-ink-950 tabular">¥{yuan(o.amountCents)}</p>
                      <Badge tone={o.status === "paid" ? "success" : o.status === "refunded" ? "muted" : "warning"}>
                        {o.status === "paid" ? "已支付" : o.status === "refunded" ? "已退款" : o.status === "pending" ? "待支付" : "失败"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-400">{label}</span>
      <span className="font-medium text-ink-950">{value}</span>
    </div>
  );
}
