import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { CONSENT_VERSION } from "@/lib/consent";

/**
 * 手机号宽松校验：优先中国大陆手机号（1[3-9] 开头 11 位），
 * 也放行带国家码的国际格式（可选 + 号 + 6-15 位数字，允许空格/连字符分隔）。
 * 只做格式闸门挡住明显垃圾/注入，不做归属地/运营商强校验。
 */
function isValidPhone(raw: string): boolean {
  const phone = raw.trim();
  if (!phone) return false;
  // 中国大陆手机号
  if (/^1[3-9]\d{9}$/.test(phone)) return true;
  // 宽松国际格式：可选 +，纯数字部分 6-15 位（去掉空格/连字符后计数）
  const digits = phone.replace(/[\s-]/g, "");
  return /^\+?\d{6,15}$/.test(digits);
}

// POST /api/leads — 预约试听留资（有道 0转正入口，端内/端外均可）
export async function POST(req: NextRequest) {
  return handle(async () => {
    // P2 安全（公开留资滥用）：无鉴权公开写，补同源校验 + IP 限流 + 手机号格式校验。
    // assertSameOrigin 对 Bearer/native 放行，web 落地页表单同源提交不受影响。
    assertSameOrigin(req);
    assertRateLimit(req, "leads", 5, 60_000);

    const user = await getCurrentUser();
    const body = (await req.json()) as {
      name?: string; phone?: string; courseId?: string; track?: string;
      source?: string; channelDetail?: string;
      privacyAccepted?: boolean; consentVersion?: string;
    };
    if (body.privacyAccepted !== true || body.consentVersion !== CONSENT_VERSION) {
      return fail("请阅读并同意隐私政策后再提交");
    }
    const phone = body.phone?.trim() || null;
    if (!phone && !user) return fail("请填写手机号以便安排试听");
    // 提供了手机号就必须合法（挡住垃圾/注入）；已登录用户可不填手机号（回退账户手机号）。
    if (phone && !isValidPhone(phone)) return fail("手机号格式不正确，请检查后重试");

    const lead = await prisma.lead.create({
      data: {
        userId: user?.id ?? null,
        name: body.name ?? user?.nickname ?? null,
        phone: phone ?? user?.phone ?? null,
        courseId: body.courseId ?? null,
        track: body.track ?? null,
        source: body.source ?? "youdao_dict",
        channelDetail: body.channelDetail ?? null,
        status: "new",
      },
    });
    await audit({
      operatorId: user?.id,
      action: "consent.accepted",
      targetType: "lead",
      targetId: lead.id,
      detail: `privacy=${CONSENT_VERSION};source=trial_booking`,
    });
    await track({
      eventName: "trial_booking",
      userId: user?.id,
      properties: { track: body.track, source: body.source ?? "youdao_dict", course_id: body.courseId },
    });
    return ok({ id: lead.id, booked: true });
  });
}
