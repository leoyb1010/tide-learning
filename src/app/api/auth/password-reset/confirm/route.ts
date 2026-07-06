import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sha256, hashPassword, validatePasswordStrength } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/password-reset/confirm — 用 token 重置密码。
 * 校验：token 存在 + 未过期 + 未使用；新密码需过强度校验。
 * 成功后更新 passwordHash 并标记 usedAt（一次性）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    assertRateLimit(req, "pwd-reset-confirm", 10, 60_000);
    const { token, password } = (await req.json()) as { token?: string; password?: string };
    if (!token || !password) return fail("参数不完整");

    const weak = validatePasswordStrength(password);
    if (weak) return fail(weak);

    const record = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return fail("重置链接无效或已过期，请重新申请");
    }

    // 事务：更新密码 + 标记 token 已用（防并发复用）+ 吊销该用户所有旧会话
    // P1-8：重置成功即失效历史登录态，避免攻击者用已窃取的旧会话在改密后继续访问。
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(password) } }),
      prisma.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);

    return ok({ message: "密码已重置，请用新密码登录。" });
  });
}
