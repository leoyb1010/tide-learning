import type { Permission } from "@/lib/session";

/** 页面级授权标记：某个细粒度权限点，或 "admin"（仅超级管理员 role==="admin" 可访问的高危页）。 */
export type AdminGate = Permission | "admin";

export interface AdminNavItem {
  href: string;
  label: string;
  /** 访问该页所需的授权，必须与对应 /api/admin/* 的 requirePermission 对齐（防 page/route 权限分叉）。 */
  gate: AdminGate;
}

/**
 * 后台导航 + 页面授权的**单一事实源**（P0-1 / P2-1）。
 *
 * 页面守卫（requireAdminPage）、导航过滤（AdminNav）、越权回退落点（safeLandingFor）统统读这张表，
 * 杜绝「page / API / nav 三处权限各写一份而漂移」——这正是审计发现 reviewer 能看 /admin、/admin/orders
 * 却被 API 403 的根因（Server Page 未与 API 做同等校验）。
 *
 * 顺序即优先级：无权访问某页时按本表自上而下取该用户可访问的首个页作为安全落点。
 */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "数据看板", gate: "dashboard:read" },
  { href: "/admin/courses", label: "课程管理", gate: "course:write" },
  { href: "/admin/content-calendar", label: "内容排期", gate: "course:write" },
  { href: "/admin/demands", label: "需求审核", gate: "demand:moderate" },
  { href: "/admin/moderation", label: "内容审核", gate: "content:review" },
  { href: "/admin/gen-quality", label: "生成质量", gate: "content:review" },
  { href: "/admin/leads", label: "建联队列", gate: "lead:manage" },
  { href: "/admin/orders", label: "订单/订阅", gate: "order:read" },
  { href: "/admin/credits", label: "积分管理", gate: "order:refund" },
  { href: "/admin/users", label: "用户管理", gate: "user:read" },
  { href: "/admin/redemption-codes", label: "兑换码", gate: "admin" },
  { href: "/admin/permissions", label: "权限管理", gate: "admin" },
  { href: "/admin/errors", label: "500 日志", gate: "admin" },
];
