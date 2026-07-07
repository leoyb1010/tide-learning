import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole, hashPassword, validatePasswordStrength, ALL_ROLES } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/[id] — 账号管理（按 body.action 分派）。高危 → requireAdminRole + assertSameOrigin + 审计。
 *   - disable：软删（deletedAt=now）+ 吊销全部会话（getCurrentUser 已对 deletedAt 用户返回 null，双保险）。
 *   - enable：清 deletedAt 恢复。
 *   - reset-password：设管理员提供的新密码哈希（复用 validatePasswordStrength + hashPassword）+ 吊销会话，强制重登。
 *   - change-role：改角色（白名单校验）。
 * 不允许对自己 disable / 降级，避免管理员误把自己锁死在后台外。
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();
    const { id } = await ctx.params;

    const body = (await req.json()) as { action?: unknown; password?: unknown; role?: unknown };
    const action = typeof body.action === "string" ? body.action : "";

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, nickname: true, role: true, deletedAt: true },
    });
    if (!target) return fail("用户不存在", 404);

    if (action === "disable") {
      if (target.id === admin.id) return fail("不能停用自己的账号");
      // 软删 + 吊销全部会话（登录态立即失效）。
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { deletedAt: new Date() } }),
        prisma.session.deleteMany({ where: { userId: id } }),
      ]);
      await audit({ operatorId: admin.id, action: "user:disable", targetType: "user", targetId: id }).catch(() => {});
      return ok({ id, deletedAt: new Date().toISOString() });
    }

    if (action === "enable") {
      await prisma.user.update({ where: { id }, data: { deletedAt: null } });
      await audit({ operatorId: admin.id, action: "user:enable", targetType: "user", targetId: id }).catch(() => {});
      return ok({ id, deletedAt: null });
    }

    if (action === "reset-password") {
      const password = typeof body.password === "string" ? body.password : "";
      const weak = validatePasswordStrength(password);
      if (weak) return fail(weak);
      // 设新哈希 + 吊销全部会话（强制用新密码重新登录）。
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } }),
        prisma.session.deleteMany({ where: { userId: id } }),
      ]);
      await audit({ operatorId: admin.id, action: "user:reset_password", targetType: "user", targetId: id }).catch(() => {});
      return ok({ id, reset: true });
    }

    if (action === "change-role") {
      const role = typeof body.role === "string" ? body.role : "";
      if (role !== "user" && !ALL_ROLES.includes(role)) return fail("非法角色");
      if (target.id === admin.id && role !== "admin") return fail("不能降级自己的超级管理员角色");
      await prisma.user.update({ where: { id }, data: { role } });
      await audit({
        operatorId: admin.id,
        action: "user:change_role",
        targetType: "user",
        targetId: id,
        detail: JSON.stringify({ from: target.role, to: role }),
      }).catch(() => {});
      return ok({ id, role });
    }

    return fail("action 仅支持 disable / enable / reset-password / change-role");
  });
}
