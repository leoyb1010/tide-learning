import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireAdminRole,
  primePermissionCache,
  invalidatePermissionCache,
  effectivePermissions,
  ALL_ROLES,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ADMIN_LOCKED_PERMISSIONS,
  type Permission,
} from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

const ROLE_SET = new Set(ALL_ROLES);
const PERM_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * GET /api/admin/permissions — 返回角色 × 权限的当前有效矩阵。
 * 每个角色标注权限来自 DB 覆盖还是代码默认（source），供 UI 展示「已改动 / 默认」。
 */
export async function GET() {
  return handle(async () => {
    await requireAdminRole();
    await primePermissionCache(true); // 强制回源，UI 拿到最新
    const matrix = ALL_ROLES.map((role) => {
      const { permissions, source } = effectivePermissions(role);
      const granted = new Set(permissions);
      return {
        role,
        source, // "db" | "default"
        permissions: ALL_PERMISSIONS.map((perm) => ({ perm, granted: granted.has(perm) })),
      };
    });
    return ok({
      roles: ALL_ROLES,
      permissions: ALL_PERMISSIONS,
      adminLocked: ADMIN_LOCKED_PERMISSIONS,
      defaults: ROLE_PERMISSIONS,
      matrix,
    });
  });
}

/**
 * POST /api/admin/permissions — 勾选/取消单个 role×permission。
 * body: { role, permission, granted }。
 * 语义：一旦对某角色写过 DB 记录，该角色即进入「DB 覆盖」模式（其余未勾选视为收回）。
 * 因此首次覆盖某角色时，会把该角色当前有效权限「固化」进 DB，再叠加本次变更，
 * 避免「勾一个反而把其它默认权限全丢了」。
 * 防自锁：admin 的核心权限不可移除。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const operator = await requireAdminRole();
    assertSameOrigin(req); // 写操作 CSRF 防护

    const body = (await req.json()) as { role?: string; permission?: string; granted?: boolean };
    const role = body.role;
    const permission = body.permission;
    const granted = body.granted;

    if (!role || !ROLE_SET.has(role)) return fail("非法角色");
    if (!permission || !PERM_SET.has(permission)) return fail("非法权限点");
    if (typeof granted !== "boolean") return fail("granted 必须为布尔值");

    // 防自锁：不允许移除 admin 的核心权限
    if (role === "admin" && granted === false && ADMIN_LOCKED_PERMISSIONS.includes(permission as Permission)) {
      return fail("不可移除超级管理员的核心权限（防自锁）", 403);
    }

    await primePermissionCache(true);
    const before = new Set(effectivePermissions(role).permissions);

    // 首次覆盖：把该角色当前有效权限固化进 DB（代码默认 → DB 记录），后续变更基于此
    const hasDbRows = await prisma.rolePermission.count({ where: { role } });
    if (hasDbRows === 0) {
      await prisma.rolePermission.createMany({
        data: ROLE_PERMISSIONS[role]?.map((perm) => ({ role, permission: perm })) ?? [],
      });
    }

    if (granted) {
      await prisma.rolePermission.upsert({
        where: { role_permission: { role, permission } },
        create: { role, permission },
        update: {},
      });
    } else {
      await prisma.rolePermission.deleteMany({ where: { role, permission } });
    }

    invalidatePermissionCache();
    await primePermissionCache(true);
    const after = new Set(effectivePermissions(role).permissions);

    await audit({
      operatorId: operator.id,
      action: "permission_change",
      targetType: "role",
      targetId: role,
      detail: JSON.stringify({
        permission,
        granted,
        before: [...before].sort(),
        after: [...after].sort(),
      }),
    });

    return ok({
      role,
      source: "db" as const,
      permissions: ALL_PERMISSIONS.map((perm) => ({ perm, granted: after.has(perm) })),
    });
  });
}

/**
 * DELETE /api/admin/permissions?role=xxx — 重置某角色为代码默认（清空其 DB 覆盖，回退兜底）。
 * 对 admin 角色重置是安全的：代码默认本就包含全部核心权限。
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const operator = await requireAdminRole();
    assertSameOrigin(req);

    const role = new URL(req.url).searchParams.get("role");
    if (!role || !ROLE_SET.has(role)) return fail("非法角色");

    const removed = await prisma.rolePermission.deleteMany({ where: { role } });
    invalidatePermissionCache();
    await primePermissionCache(true);

    await audit({
      operatorId: operator.id,
      action: "permission_change",
      targetType: "role",
      targetId: role,
      detail: JSON.stringify({ reset: true, removedRows: removed.count }),
    });

    const def = ROLE_PERMISSIONS[role] ?? [];
    const grantedSet = new Set(def);
    return ok({
      role,
      source: "default" as const,
      permissions: ALL_PERMISSIONS.map((perm) => ({ perm, granted: grantedSet.has(perm) })),
    });
  });
}
