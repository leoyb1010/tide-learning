import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getCurrentUser, hasPermission, primePermissionCache } from "@/lib/session";
import { ADMIN_NAV, type AdminGate, type AdminNavItem } from "@/lib/admin-nav";

/**
 * 后台页面级权限（P0-1）+ 导航过滤（P2-1）的共享判定层。
 *
 * 关键约定：调用同步 canAccessGate 前必须先 `await primePermissionCache()`，
 * 以读到 DB 覆盖后的最新权限（与 requirePermission 内部一致）。
 */

/** 该 gate 对某角色是否放行（同步；调用前须已 primePermissionCache）。 */
export function canAccessGate(role: string, gate: AdminGate): boolean {
  if (gate === "admin") return role === "admin";
  return hasPermission(role, gate);
}

/** 该用户可见的后台导航项（越权入口不展示）——供 AdminNav 渲染（P2-1）。 */
export function adminNavForUser(role: string): AdminNavItem[] {
  return ADMIN_NAV.filter((it) => canAccessGate(role, it.gate));
}

/**
 * 无权访问某页时的安全落点：按 ADMIN_NAV 顺序取该用户可访问的首个「非当前页」后台页；
 * 一个都没有 → 前台首页 "/"。绝不回落到自身，杜绝 redirect 死循环
 * （例如 reviewer 访问 /admin 无 dashboard:read → 落到 /admin/moderation，而非再次 /admin）。
 */
export function safeLandingFor(role: string, currentPath: string): string {
  const first = ADMIN_NAV.find((it) => it.href !== currentPath && canAccessGate(role, it.gate));
  return first?.href ?? "/";
}

/**
 * 后台**页面级**权限门（P0-1）：与对应 API 的 requirePermission 严格对齐。
 *
 * RSC / Server Page 必须各自调用本函数；AdminLayout 只负责「是不是后台身份」，
 * 不能替各页做细粒度校验（审计发现的泄露正是「layout 放行 + page 直接渲染敏感数据」）。
 *
 * - 未登录 → /login?next=<path>；
 * - 已登录但无该页权限 → 重定向到该用户可访问的页（不抛 500、不无限循环）。
 */
export async function requireAdminPage(gate: AdminGate, path: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${path}`);
  await primePermissionCache();
  if (!canAccessGate(user.role, gate)) {
    redirect(safeLandingFor(user.role, path));
  }
  return user;
}
