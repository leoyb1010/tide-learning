import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** 生成一枚不易猜的短邀请码（大写字母数字，去掉易混字符）。 */
function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去 I/O/0/1
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/**
 * GET /api/referral — 读取当前用户的邀请码（若尚未生成返回 code:null）。
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const invite = await prisma.inviteCode.findUnique({ where: { inviterId: user.id } });
    return ok({ code: invite?.code ?? null });
  });
}

/**
 * POST /api/referral — 生成/获取当前用户邀请码（幂等，一人一码）。
 * 幂等实现：inviterId @unique。已存在直接返回旧码；并发首建时靠 unique 约束兜底重取。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, "referral-code", 20, 60_000);

    const existing = await prisma.inviteCode.findUnique({ where: { inviterId: user.id } });
    if (existing) return ok({ code: existing.code, created: false });

    // 生成唯一 code：重试几次避开偶发碰撞；inviterId @unique 保证一人一码。
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode();
      try {
        const created = await prisma.inviteCode.create({
          data: { inviterId: user.id, code },
        });
        return ok({ code: created.code, created: true });
      } catch {
        // 唯一冲突：可能是 inviterId 并发首建（他人已建当前用户的码）或 code 撞车。
        const now = await prisma.inviteCode.findUnique({ where: { inviterId: user.id } });
        if (now) return ok({ code: now.code, created: false }); // 并发已建 → 返回既有码（幂等）
        // 否则是 code 撞车，换码重试
      }
    }
    // 极端情况下多次撞码：兜底再读一次
    const fallback = await prisma.inviteCode.findUnique({ where: { inviterId: user.id } });
    return ok({ code: fallback?.code ?? null, created: false });
  });
}
