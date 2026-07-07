import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { redeemCode } from "@/lib/redemption";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/redeem — 用户兑换码兑换入口。
 * requireUser + assertSameOrigin + 按账号限流（10 次/分，防暴力枚举/刷量）。
 * body: { code }。原子核销由 redeemCode 完成，返回本次发放内容（积分数/会员天数）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    // 高价值敏感操作：按账号限每分钟 10 次（对齐 iap/verify 的限流强度）。
    assertUserRateLimit(user.id, "redeem", 10, 60_000);

    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code.trim()) return fail("请输入兑换码");

    const result = await redeemCode(user.id, code);

    await track({
      eventName: "redeem_code",
      userId: user.id,
      properties: { granted_type: result.type, granted_value: result.value },
    }).catch(() => {});

    return ok(result);
  });
}
