import { AdminUserManager } from "@/components/admin/AdminUserManager";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "用户管理" };

/**
 * 用户管理：列表 + 管理动作（创建账号 / 停用·启用 / 重置密码 / 改角色 / 发积分 / 赠会员）。
 * 页面级权限门（P0-1）：user:read（与 /api/admin/users 对齐）——列表含邮箱/手机号等 PII，
 * 不再「任一后台角色可见」。写动作仍仅超级管理员（API 侧 requireAdminRole 强制 + 此处 UI 显隐双闸）。
 */
export default async function AdminUsersPage() {
  const user = await requireAdminPage("user:read", "/admin/users");
  const isSuperAdmin = user.role === "admin";

  return (
    <div className="space-y-4">
      <div>
        <div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">USERS · 用户</div>
        <h1 className="mt-1 text-[22px] font-bold text-[var(--ink)]">用户管理</h1>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          查询用户；超级管理员可创建账号、停用/启用、重置密码、调整角色，并发放积分或赠送会员。所有操作写入审计日志。
        </p>
      </div>
      <AdminUserManager isSuperAdmin={isSuperAdmin} currentUserId={user.id} />
    </div>
  );
}
