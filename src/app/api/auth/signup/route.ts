import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession, validatePasswordStrength, normalizeAccountIdentifier } from "@/lib/session";
import { ok, fail, handle } from "@/lib/api";
import { track } from "@/lib/analytics";
import { ensureAccount } from "@/lib/credits";
import { assertRateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { CONSENT_VERSION } from "@/lib/consent";

export async function POST(req: NextRequest) {
  return handle(async () => {
    // 与 login/改密/重置对齐：注册也须限流，抑制垃圾账号。按 IP 限：同 IP 5 次/分。
    assertRateLimit(req, "signup", 5, 60_000);
    const body = await req.json();
    const { identifier, password, nickname, termsAccepted, privacyAccepted, consentVersion } = body as {
      identifier?: string;
      password?: string;
      nickname?: string;
      termsAccepted?: boolean;
      privacyAccepted?: boolean;
      consentVersion?: string;
    };
    if (termsAccepted !== true || privacyAccepted !== true || consentVersion !== CONSENT_VERSION) {
      return fail("请阅读并同意用户协议与隐私政策");
    }
    if (typeof identifier !== "string" || typeof password !== "string") return fail("请填写账号和密码");
    const account = normalizeAccountIdentifier(identifier);
    if (!account.value || account.value.length > 254) return fail("账号格式不正确");
    if (account.kind === "username") return fail("请输入有效的邮箱或手机号");
    if (account.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.value)) {
      return fail("邮箱格式不正确");
    }
    // 复用与改密/重置同一套强度校验（≥8 位、含字母与数字、非黑名单），
    // 避免注册留下弱密码后门与规则分叉。
    const weak = validatePasswordStrength(password);
    if (weak) return fail(weak);

    // signup 仅支持 email/phone identifier；username 为体验账号专用预置字段，注册不设。
    const isEmail = account.kind === "email";
    const where = isEmail ? { email: account.value } : { phone: account.value };
    const existing = await prisma.user.findFirst({ where });
    if (existing) return fail("账号已存在，请直接登录");

    await track({ eventName: "signup_start", properties: { method: isEmail ? "email" : "phone" } });

    // 昵称净化：去控制字符/换行 + trim + 截断，防止拼进通知标题投放骚扰。
    const cleanNickname = (nickname ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 20);
    const finalNickname =
      cleanNickname || (isEmail ? account.value.split("@")[0] : `用户${account.value.slice(-4)}`);

    const user = await prisma.user.create({
      data: {
        email: isEmail ? account.value : null,
        phone: isEmail ? null : account.value,
        nickname: finalNickname,
        passwordHash: hashPassword(password),
        profile: { create: {} },
      },
    });
    const sessionToken = await createSession(user.id);
    await audit({
      operatorId: user.id,
      action: "consent.accepted",
      targetType: "user",
      targetId: user.id,
      detail: `terms=${CONSENT_VERSION};privacy=${CONSENT_VERSION};source=signup`,
    });
    // 注册只建零余额积分账户；未验证邮箱/手机号不得自动获得可交易积分。
    // 不放进 user.create 事务：建账失败不应阻断注册，购买预检处还有惰性兜底。
    await ensureAccount(user.id).catch((e) => console.error("[signup:ensureAccount]", e));
    await track({ eventName: "signup_success", userId: user.id });
    return ok({ id: user.id, nickname: user.nickname, sessionToken });
  });
}
