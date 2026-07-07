import {
  primePermissionCache,
  effectivePermissions,
  ALL_ROLES,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ADMIN_LOCKED_PERMISSIONS,
} from "@/lib/session";
import { requireAdminPage } from "@/lib/admin-guard";
import { PermissionMatrix, type RoleRow } from "./PermissionMatrix";

export const metadata = { title: "权限矩阵" };
export const dynamic = "force-dynamic";

export default async function AdminPermissionsPage() {
  // 仅超级管理员可访问（P0-1）：无权者重定向到可访问页（不走细粒度权限点，避免自锁死循环）。
  await requireAdminPage("admin", "/admin/permissions");

  await primePermissionCache(true);

  const rows: RoleRow[] = ALL_ROLES.map((role) => {
    const { permissions, source } = effectivePermissions(role);
    const granted = new Set(permissions);
    return {
      role,
      source,
      cells: ALL_PERMISSIONS.map((perm) => ({ perm, granted: granted.has(perm) })),
    };
  });

  return (
    <PermissionMatrix
      initialRows={rows}
      permissions={ALL_PERMISSIONS}
      defaults={ROLE_PERMISSIONS}
      adminLocked={ADMIN_LOCKED_PERMISSIONS}
    />
  );
}
