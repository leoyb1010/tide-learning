import { AdminDemandManager } from "@/components/admin/AdminDemandManager";
import { requireAdminPage } from "@/lib/admin-guard";

export default async function AdminDemandsPage() {
  // 页面级权限门（P0-1）：与需求审核 API 的 requirePermission("demand:moderate") 对齐。
  await requireAdminPage("demand:moderate", "/admin/demands");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">需求审核</h1>
      <p className="text-sm text-ink-400">审核、合并重复需求、变更状态、填写官方反馈。未采纳必须填原因。</p>
      <AdminDemandManager />
    </div>
  );
}
