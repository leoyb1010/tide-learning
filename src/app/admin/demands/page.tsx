import { AdminDemandManager } from "@/components/admin/AdminDemandManager";

export default function AdminDemandsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">需求审核</h1>
      <p className="text-sm text-ink-400">审核、合并重复需求、变更状态、填写官方反馈。未采纳必须填原因。</p>
      <AdminDemandManager />
    </div>
  );
}
