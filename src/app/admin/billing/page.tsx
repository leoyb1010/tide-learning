import { requireAdminPage } from "@/lib/admin-guard";
import { BillingReconciliationQueue } from "@/components/admin/BillingReconciliationQueue";

export const metadata = { title: "费用对账" };

export default async function AdminBillingPage() {
  await requireAdminPage("order:refund", "/admin/billing");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">费用对账</h1>
        <p className="mt-1 text-sm text-ink-400">处理 AI 供应商超时或结算异常记录。每次处理都需要原因并写入审计日志。</p>
      </div>
      <BillingReconciliationQueue />
    </div>
  );
}
