import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as { identifier?: string; password?: string } | null;
    const identifier = body?.identifier;
    const password = body?.password;
    if (!identifier || !password) return fail("请填写账号和密码");
    // A1-4：登录双维度限流——账号维度防定向撞库，IP 维度防字典撒网。
    // 账号维度不受 XFF 伪造影响（key 含 identifier）；IP 维度用已加固的 clientIp。
    assertRateLimit(req, `login:${identifier}`, 5, 60_000);
    assertRateLimit(req, "login-ip", 20, 60_000);
    // 含 @ → 邮箱；否则按 手机号 或 短用户名 命中（体验账号 dingyue / admin 走 username）。
    const isEmail = identifier.includes("@");
    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: identifier }
        : { OR: [{ phone: identifier }, { username: identifier }] },
    });
    if (!user || user.deletedAt || !verifyPassword(password, user.passwordHash)) {
      return fail("账号或密码不正确", 401);
    }
    const sessionToken = await createSession(user.id);
    // sessionToken 供原生 App 用 Authorization: Bearer 携带（Web 用 httpOnly cookie，不读此字段）。
    return ok({ id: user.id, nickname: user.nickname, role: user.role, sessionToken });
  });
}
