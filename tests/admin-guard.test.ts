import { describe, it, expect, vi } from "vitest";

// admin-guard → session 顶层 import 了 ./db（prisma）；只测纯判定函数，mock 掉以免实例化 prisma。
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { canAccessGate, adminNavForUser, safeLandingFor } from "@/lib/admin-guard";
import { ADMIN_NAV } from "@/lib/admin-nav";

/**
 * 后台页面级 RBAC 单一事实源回归（P0-1 / P2-1）。
 *
 * 锁死「page / API / nav 三处权限一致」：审计发现 reviewer 被 API 403 却能经 Server Page 读到
 * 看板与订单 PII。这里以代码兜底权限矩阵（ROLE_PERMISSIONS）为基准，锁定每个后台页的可访问角色、
 * 导航过滤结果、以及越权时的安全落点（不回落自身、不死循环）。
 */

describe("canAccessGate —— 页面 gate 与角色权限对齐", () => {
  it("reviewer 仅可访问内容审核，不可访问看板/订单/用户/权限", () => {
    expect(canAccessGate("reviewer", "content:review")).toBe(true);
    expect(canAccessGate("reviewer", "dashboard:read")).toBe(false);
    expect(canAccessGate("reviewer", "order:read")).toBe(false);
    expect(canAccessGate("reviewer", "user:read")).toBe(false);
    expect(canAccessGate("reviewer", "admin")).toBe(false);
  });

  it("support：订单/用户/建联可访问，看板不可", () => {
    expect(canAccessGate("support", "order:read")).toBe(true);
    expect(canAccessGate("support", "user:read")).toBe(true);
    expect(canAccessGate("support", "lead:manage")).toBe(true);
    expect(canAccessGate("support", "dashboard:read")).toBe(false);
    expect(canAccessGate("support", "admin")).toBe(false);
  });

  it("finance：看板/订单/退款可访问，用户不可", () => {
    expect(canAccessGate("finance", "dashboard:read")).toBe(true);
    expect(canAccessGate("finance", "order:read")).toBe(true);
    expect(canAccessGate("finance", "order:refund")).toBe(true);
    expect(canAccessGate("finance", "user:read")).toBe(false);
  });

  it("content_manager / demand_moderator 各守其位", () => {
    expect(canAccessGate("content_manager", "course:write")).toBe(true);
    expect(canAccessGate("content_manager", "order:read")).toBe(false);
    expect(canAccessGate("demand_moderator", "demand:moderate")).toBe(true);
    expect(canAccessGate("demand_moderator", "course:write")).toBe(false);
  });

  it("admin：所有 gate 放行，含超级管理员专属 admin gate", () => {
    for (const item of ADMIN_NAV) expect(canAccessGate("admin", item.gate)).toBe(true);
    expect(canAccessGate("admin", "admin")).toBe(true);
  });

  it("普通用户（非后台角色）：所有 gate 拒绝", () => {
    for (const item of ADMIN_NAV) expect(canAccessGate("user", item.gate)).toBe(false);
  });
});

describe("adminNavForUser —— 导航按有效权限过滤（P2-1）", () => {
  it("reviewer 只看到「内容审核」一个入口", () => {
    const nav = adminNavForUser("reviewer");
    expect(nav.map((n) => n.href)).toEqual(["/admin/moderation"]);
  });

  it("admin 看到全部入口", () => {
    expect(adminNavForUser("admin")).toHaveLength(ADMIN_NAV.length);
  });

  it("finance 看到看板/订单/积分，且不含用户/权限/兑换码", () => {
    const hrefs = adminNavForUser("finance").map((n) => n.href);
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/orders");
    expect(hrefs).toContain("/admin/credits");
    expect(hrefs).not.toContain("/admin/users");
    expect(hrefs).not.toContain("/admin/permissions");
    expect(hrefs).not.toContain("/admin/redemption-codes");
  });

  it("兑换码/权限/500 日志三个高危入口仅 admin 可见", () => {
    for (const role of ["reviewer", "support", "finance", "content_manager", "demand_moderator"]) {
      const hrefs = adminNavForUser(role).map((n) => n.href);
      expect(hrefs).not.toContain("/admin/redemption-codes");
      expect(hrefs).not.toContain("/admin/permissions");
      expect(hrefs).not.toContain("/admin/errors");
    }
  });
});

describe("safeLandingFor —— 越权安全落点，绝不回落自身/死循环", () => {
  it("reviewer 访问 /admin 或 /admin/orders → 落到 /admin/moderation", () => {
    expect(safeLandingFor("reviewer", "/admin")).toBe("/admin/moderation");
    expect(safeLandingFor("reviewer", "/admin/orders")).toBe("/admin/moderation");
  });

  it("support 访问 /admin（无看板权限）→ 落到首个可访问页 /admin/leads", () => {
    expect(safeLandingFor("support", "/admin")).toBe("/admin/leads");
  });

  it("落点绝不等于当前路径（避免 redirect 死循环）", () => {
    for (const role of ["reviewer", "support", "finance", "content_manager", "demand_moderator", "admin"]) {
      for (const item of ADMIN_NAV) {
        expect(safeLandingFor(role, item.href)).not.toBe(item.href);
      }
    }
  });

  it("无任何可访问页的角色 → 落到前台首页", () => {
    expect(safeLandingFor("user", "/admin")).toBe("/");
  });
});
