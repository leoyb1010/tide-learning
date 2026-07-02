import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";

export const metadata = { title: "用户管理" };

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { notes: true, orders: true } }, subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 1 } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">用户管理（{users.length}）</h1>
      <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 text-left text-ink-400">
            <tr><th className="px-4 py-3">昵称</th><th className="px-4 py-3">账号</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">订阅</th><th className="px-4 py-3">笔记</th><th className="px-4 py-3">订单</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-ink-950">{u.nickname}</td>
                <td className="px-4 py-3 text-ink-500">{u.email ?? u.phone}</td>
                <td className="px-4 py-3">{u.role === "user" ? <span className="text-ink-400">用户</span> : <Badge tone="tide">{u.role}</Badge>}</td>
                <td className="px-4 py-3"><Badge tone={u.subscriptions[0]?.status === "active" ? "success" : "muted"}>{u.subscriptions[0]?.status ?? "free"}</Badge></td>
                <td className="px-4 py-3 tabular">{u._count.notes}</td>
                <td className="px-4 py-3 tabular">{u._count.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
