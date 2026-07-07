import { getCurrentUser } from "@/lib/session";
import { AdminUserManager } from "@/components/admin/AdminUserManager";

export const metadata = { title: "用户管理" };

/**
 * 用户管理：列表 + 管理动作（创建账号 / 停用·启用 / 重置密码 / 改角色 / 发积分 / 赠会员）。
 * 列表任一后台角色可见（layout 已保证）；写动作仅超级管理员（API 侧 requireAdminRole 强制，
 * 此处按 role 传 isSuperAdmin 控制 UI 显隐，前后端双闸）。
 */
export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  const isSuperAdmin = user?.role === "admin";

  return (
    <div className="space-y-4">
      <div>
        <div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">USERS · 用户</div>
        <h1 className="mt-1 text-[22px] font-bold text-[var(--ink)]">用户管理</h1>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          查询用户；超级管理员可创建账号、停用/启用、重置密码、调整角色，并发放积分或赠送会员。所有操作写入审计日志。
        </p>
      </div>
      <AdminUserManager isSuperAdmin={isSuperAdmin} currentUserId={user?.id ?? ""} />
    </div>
  );
}
