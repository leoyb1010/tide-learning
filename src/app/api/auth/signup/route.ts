import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, validatePasswordStrength } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";
import { track } from "@/lib/analytics";
import { ensureAccount } from "@/lib/credits";
import { assertRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  return handle(async () => {
    // 与 login/改密/重置对齐：注册也须限流。每次注册自动建号并发放注册积分，
    // 无限流可被脚本批量刷号薅积分/灌垃圾账号。按 IP 限：同 IP 5 次/分。
    assertRateLimit(req, "signup", 5, 60_000);
    const body = await req.json();
    const { identifier, password, nickname } = body as {
      identifier?: string;
      password?: string;
      nickname?: string;
    };
    if (!identifier || !password) return fail("请填写账号和密码");
    // 复用与改密/重置同一套强度校验（≥8 位、含字母与数字、非黑名单），
    // 避免注册留下弱密码后门与规则分叉。
    const weak = validatePasswordStrength(password);
    if (weak) return fail(weak);

    // signup 仅支持 email/phone identifier；username 为体验账号专用预置字段，注册不设。
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
    const sessionToken = await createSession(user.id);
    // 注册即建积分账户并发放注册赠送（ensureAccount 幂等，含流水）；
    // 不放进 user.create 事务：赠送失败不应阻断注册，购买预检处还有惰性兜底。
    await ensureAccount(user.id).catch((e) => console.error("[signup:ensureAccount]", e));
    await track({ eventName: "signup_success", userId: user.id });
    return ok({ id: user.id, nickname: user.nickname, sessionToken });
  });
}
