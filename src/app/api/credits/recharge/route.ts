import { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { grantCredits, getBalance } from "@/lib/credits";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * 积分充值档位（v2.3 §6 充值）。
 * 沿用项目 mock-pay 风格：mock 模式下服务端直接视为支付成功并入账；
 * 真实支付需先建订单 → 跳渠道收银台 → webhook 回调后由 processWebhook 触发入账。
 */
const PACKS: Record<string, { yuan: number; credits: number; label: string }> = {
  pack_small: { yuan: 6, credits: 60, label: "60 积分" },
  pack_mid: { yuan: 30, credits: 350, label: "350 积分" },
  pack_large: { yuan: 98, credits: 1300, label: "1300 积分" },
};

/**
 * POST /api/credits/recharge — 积分充值（mock 支付）。
 * body: { packId }
 *
 * 与 mock-pay 一致的生产保护：mock 直接入账仅用于开发/演示，生产环境 403
 * （生产走真实渠道 webhook，不允许前端触发的「免费入账」）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (process.env.NODE_ENV === "production") return fail("mock 充值仅限非生产环境", 403);
    assertSameOrigin(req);
    assertRateLimit(req, "credits-recharge", 20, 60_000);
    const user = await requireUser();

    const { packId } = (await req.json()) as { packId?: string };
    if (!packId) return fail("缺少充值档位");

    const pack = PACKS[packId];
    if (!pack) return fail("非法的充值档位");

    // mock 模式：直接视为支付成功，入账积分。
    // TODO(真实支付)：改为 createOrder(user.id, { kind:"credit_recharge", packId, amount:pack.yuan })
    //   → 返回收银台跳转 URL；实际入账在 payment webhook 成功回调里调 grantCredits，
    //   type 保持 "recharge"，refId 绑定订单号，保证与流水对账一致。
    const balance = await grantCredits(user.id, pack.credits, "recharge", {
      reason: `充值 ${pack.label}`,
    });

    return ok({ balance, granted: pack.credits });
  });
}
