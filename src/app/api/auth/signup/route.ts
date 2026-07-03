import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";
import { track } from "@/lib/analytics";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const { identifier, password, nickname } = body as {
      identifier?: string;
      password?: string;
      nickname?: string;
    };
    if (!identifier || !password) return fail("请填写账号和密码");
    if (password.length < 6) return fail("密码至少 6 位");

    const isEmail = identifier.includes("@");
    const where = isEmail ? { email: identifier } : { phone: identifier };
    const existing = await prisma.user.findFirst({ where });
    if (existing) return fail("账号已存在，请直接登录");

    await track({ eventName: "signup_start", properties: { method: isEmail ? "email" : "phone" } });

    // 昵称净化：去控制字符/换行 + trim + 截断，防止拼进通知标题投放骚扰。
    const cleanNickname = (nickname ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 20);
    const finalNickname =
      cleanNickname || (isEmail ? identifier.split("@")[0] : `用户${identifier.slice(-4)}`);

    const user = await prisma.user.create({
      data: {
        email: isEmail ? identifier : null,
        phone: isEmail ? null : identifier,
        nickname: finalNickname,
        passwordHash: hashPassword(password),
        profile: { create: {} },
      },
    });
    await createSession(user.id);
    await track({ eventName: "signup_success", userId: user.id });
    return ok({ id: user.id, nickname: user.nickname });
  });
}
