import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { identifier, password } = (await req.json()) as { identifier?: string; password?: string };
    if (!identifier || !password) return fail("请填写账号和密码");
    const isEmail = identifier.includes("@");
    const user = await prisma.user.findFirst({
      where: isEmail ? { email: identifier } : { phone: identifier },
    });
    if (!user || user.deletedAt || !verifyPassword(password, user.passwordHash)) {
      return fail("账号或密码不正确", 401);
    }
    await createSession(user.id);
    return ok({ id: user.id, nickname: user.nickname, role: user.role });
  });
}
