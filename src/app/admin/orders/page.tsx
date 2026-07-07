import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { yuan } from "@/lib/format";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "订单/订阅" };

export default async function AdminOrdersPage() {
  // 页面级权限门（P0-1）：与 /api/admin/orders 的 requirePermission("order:read") 对齐。
  // 修复审计发现的 PII 泄露——reviewer 曾能经本页读取订单、用户邮箱/手机号。
  await requireAdminPage("order:read", "/admin/orders");

  const [orders, webhookLogs] = await Promise.all([
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { plan: true, user: { select: { nickname: true, email: true, phone: true } } } }),
    prisma.paymentWebhookLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink-950">订单与订阅</h1>

      <section>
        <h2 className="mb-3 font-medium text-ink-950">订单（{orders.length}）</h2>
        <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 text-left text-ink-400">
              <tr><th className="px-4 py-3">用户</th><th className="px-4 py-3">套餐</th><th className="px-4 py-3">渠道</th><th className="px-4 py-3">金额</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">时间</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 text-ink-950">{o.user.nickname}<br /><span className="text-xs text-ink-400">{o.user.email ?? o.user.phone}</span></td>
                  <td className="px-4 py-3">{o.plan.name}</td>
                  <td className="px-4 py-3 text-ink-500">{o.channel}</td>
                  <td className="px-4 py-3 tabular">¥{yuan(o.amountCents)}</td>
                  <td className="px-4 py-3"><Badge tone={o.status === "paid" ? "success" : o.status === "refunded" ? "muted" : "warning"}>{o.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-ink-400">{new Date(o.createdAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-medium text-ink-950">支付 Webhook 记录（幂等）</h2>
        <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 text-left text-ink-400">
              <tr><th className="px-4 py-3">渠道</th><th className="px-4 py-3">事件</th><th className="px-4 py-3">幂等键</th><th className="px-4 py-3">状态</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {webhookLogs.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-400">暂无记录</td></tr>}
              {webhookLogs.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-3">{w.channel}</td>
                  <td className="px-4 py-3 text-ink-500">{w.eventType}</td>
                  <td className="px-4 py-3 text-xs text-ink-400">{w.externalId.slice(0, 16)}…</td>
                  <td className="px-4 py-3"><Badge tone={w.status === "processed" ? "success" : w.status === "error" ? "error" : "muted"}>{w.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
