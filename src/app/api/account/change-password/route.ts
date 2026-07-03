import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireUser,
  verifyPassword,
  hashPassword,
  validatePasswordStrength,
} from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/change-password — 已登录用户在设置里改密码。
 * 入参：{ currentPassword, newPassword, confirmPassword }。
 * 校验：同源(CSRF) + 登录态 + 限流 + 强度(≥8 位含字母数字，非黑名单) + 当前密码正确。
 * 第三方登录账号（authProvider!=password 或无 passwordHash）不支持此操作。
 * 成功后吊销该用户全部会话（安全优先，用户需重新登录一次）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, `change-password:${user.id}`, 5, 60_000);

    const body = (await req.json().catch(() => null)) as
      | { currentPassword?: string; newPassword?: string; confirmPassword?: string }
      | null;
    const currentPassword = (body?.currentPassword ?? "").trim();
    const newPassword = (body?.newPassword ?? "").trim();
    const confirmPassword = (body?.confirmPassword ?? "").trim();
    if (!currentPassword || !newPassword) return fail("请填写当前密码和新密码");
    if (newPassword !== confirmPassword) return fail("两次输入的新密码不一致");
    if (newPassword === currentPassword) return fail("新密码不能与当前密码相同");

    // 第三方登录账号无本地密码，无法在此修改
    if (user.authProvider !== "password" || !user.passwordHash) {
      return fail("第三方登录账号请通过原渠道管理");
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return fail("当前密码不正确");
    }

    const weak = validatePasswordStrength(newPassword);
    if (weak) return fail(weak);

    // 越权铁律：where userId
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    });

    // 改密后吊销全部会话，避免旧凭据被继续使用
    await prisma.session.deleteMany({ where: { userId: user.id } });

    await track({ eventName: "account_change_password", userId: user.id });

    return ok({ changed: true });
  });
}
