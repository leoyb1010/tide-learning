import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sha256, hashPassword, validatePasswordStrength } from "@/lib/session";
import { ok, fail, handle, AppError, assertSameOrigin } from "@/lib/api";
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
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("参数不完整");
    const { token, password } = body as { token?: unknown; password?: unknown };
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || typeof password !== "string") return fail("参数不完整");

    const weak = validatePasswordStrength(password);
    if (weak) return fail(weak);

    const record = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      return fail("重置链接无效或已过期，请重新申请");
    }

    const passwordHash = hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Claim atomically; the earlier lookup alone cannot enforce single use.
      const claimed = await tx.passwordReset.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new AppError("重置链接无效或已过期，请重新申请", 400);
      const updated = await tx.user.updateMany({
        where: { id: record.userId, deletedAt: null }, data: { passwordHash },
      });
      if (updated.count !== 1) throw new AppError("重置链接无效或已过期，请重新申请", 400);
      await tx.passwordReset.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });
      await tx.session.deleteMany({ where: { userId: record.userId } });
    });

    return ok({ message: "密码已重置，请用新密码登录。" });
  });
}
