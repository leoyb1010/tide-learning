import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, DUMMY_PASSWORD_HASH } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";
import { assertKeyRateLimit, assertRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as { identifier?: string; password?: string } | null;
    const identifier = body?.identifier;
    const password = body?.password;
    if (!identifier || !password) return fail("请填写账号和密码");
    // A1-4：登录双维度限流——账号维度防定向撞库，IP 维度防字典撒网。
    // 账号桶必须是纯账号 key，不能再经 assertRateLimit 拼入 IP，否则轮换出口即可绕过。
    // trim + 小写化同时堵住前后空格和邮箱/用户名大小写变体造成的桶分裂。
    const accountKey = identifier.trim().toLocaleLowerCase("en-US");
    assertKeyRateLimit(`login-account:${accountKey}`, 5, 60_000);
    assertRateLimit(req, "login-ip", 20, 60_000);
    // 含 @ → 邮箱；否则按 手机号 或 短用户名 命中（体验账号 dingyue / admin 走 username）。
    const isEmail = identifier.includes("@");
    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: identifier }
        : { OR: [{ phone: identifier }, { username: identifier }] },
    });
    // 恒定时间路径（P2-9）：无论账号是否存在都跑一次 verifyPassword——
    // 账号缺失/已删时对常量假哈希派生，抹平「scrypt 只在账号存在时才执行」的时序差（防用户枚举）。
    // 短路 `||` 会在 !user 时跳过昂贵 scrypt，故先无条件算出 passOk 再判定。
    const active = user && !user.deletedAt ? user : null;
    const passOk = verifyPassword(password, active ? active.passwordHash : DUMMY_PASSWORD_HASH);
    if (!active || !passOk) {
      return fail("账号或密码不正确", 401);
    }
    const sessionToken = await createSession(active.id);
    // sessionToken 供原生 App 用 Authorization: Bearer 携带（Web 用 httpOnly cookie，不读此字段）。
    return ok({ id: active.id, nickname: active.nickname, role: active.role, sessionToken });
  });
}
