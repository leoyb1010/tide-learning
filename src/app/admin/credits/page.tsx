import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission, primePermissionCache } from "@/lib/session";
import { AdminCreditManager } from "@/components/admin/AdminCreditManager";

export const metadata = { title: "积分管理" };

/**
 * 积分管理后台：查询用户积分账户 + 手动调账（补偿/扣减）。
 * 权限门：order:refund（退款/权益补偿口子）；无权者 redirect 回后台首页。
 * 布局 layout 已保证是后台角色，此处再做细粒度校验。
 */
export default async function AdminCreditsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/credits");
  await primePermissionCache();
  if (!hasPermission(user.role, "order:refund")) redirect("/admin");

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
