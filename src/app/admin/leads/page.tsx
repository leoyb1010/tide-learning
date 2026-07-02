import { AdminLeadManager } from "@/components/admin/AdminLeadManager";

export const metadata = { title: "建联队列" };

export default function AdminLeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">建联队列（预约试听 · 电联转化）</h1>
      <p className="text-sm text-ink-400">融合有道 0转正漏斗：端内私域 / 端外投放留资 → 电联建联 → 试听 → 转化。</p>
      <AdminLeadManager />
    </div>
  );
}
