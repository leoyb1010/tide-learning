import { AdminCreditManager } from "@/components/admin/AdminCreditManager";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "积分管理" };

/**
 * 积分管理后台：查询用户积分账户 + 手动调账（补偿/扣减）。
 * 页面级权限门（P0-1）：order:refund（退款/权益补偿口子），与 /api/admin/credits 对齐；
 * 无权者重定向到可访问页（不回落自身，避免死循环）。
 */
export default async function AdminCreditsPage() {
  await requireAdminPage("order:refund", "/admin/credits");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--ink)]">积分管理</h1>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          查询用户积分账户、审阅流水，并做补偿入账或扣减调账。所有调账写入审计日志。
        </p>
      </div>
      <AdminCreditManager />
    </div>
  );
}
