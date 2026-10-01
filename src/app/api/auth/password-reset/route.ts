import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 小时

/**
 * POST /api/auth/password-reset — 申请密码找回。
 * 生成一次性 token（明文只回传一次），sha256 后存 PasswordReset，1h 过期。
 * 安全：
 *  - 无论邮箱是否存在都返回相同成功文案（不暴露账号是否注册，防枚举）。
 *  - 严格限流（防刷发信 / 撞库探测）。
 *  - 开发环境把明文 token 放 response.data.devToken 便于本地测试。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    assertRateLimit(req, "pwd-reset-request", 5, 60_000);
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("请求体格式错误");
    const rawEmail = (body as { email?: unknown }).email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    // No email delivery adapter exists yet. Do not mint undeliverable tokens or
    // falsely tell production users that a recovery email has been sent.
    if (process.env.NODE_ENV === "production") return fail("密码找回暂未开放，请通过帮助中心联系支持", 503);

    const generic = ok({ message: "若该邮箱已注册，我们已发送重置链接，请查收邮件。" });
    if (!email) return generic;

    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) return generic; // 不泄露账号是否存在

    const token = randomBytes(32).toString("hex");
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    // Only development/test reaches this branch; production is gated above.
    return ok({ message: "开发测试重置令牌已生成。", devToken: token });
  });
}
