import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/session";
import { grantCredits } from "@/lib/credits";
import { resolveAdminTargetUser } from "@/lib/admin-users";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/credits/grant — 管理员发放积分（仅入账，正数）。
 * 高危 → requireAdminRole + assertSameOrigin + 审计。复用 grantCredits（type=admin_grant）。
 * 定位用户：优先 userId；否则按 email 精确、再按 nickname 精确匹配（唯一命中才发）。
 * body: { userId? | email? | nickname?, amount, reason }。
 * 与 /api/admin/credits/adjust 的区别：adjust 支持负数扣减(order:refund 财务口)，
 * 本口是纯发放(admin_grant)、仅超级管理员，语义更聚焦运营赠送。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();

    const body = (await req.json()) as {
      userId?: unknown; email?: unknown; nickname?: unknown; amount?: unknown; reason?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!Number.isFinite(amount) || amount <= 0) return fail("发放积分须为正整数");
    if (amount > 1_000_000) return fail("单次发放幅度过大");
    if (!reason) return fail("请填写发放原因（审计留痕）");

    const target = await resolveAdminTargetUser({ userId, email, nickname });
    if ("error" in target) return fail(target.error, target.status);

    const balance = await grantCredits(target.id, amount, "admin_grant", { reason });

    await audit({
      operatorId: admin.id,
      action: "credit_grant",
      targetType: "user",
      targetId: target.id,
      detail: `+${amount} · ${reason}`,
    }).catch(() => {});

    return ok({ userId: target.id, nickname: target.nickname, delta: amount, balance });
  });
}
