import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/redemption-codes/[id] — 作废/启用某个兑换码。
 * body: { action: "disable" | "enable" }。requireAdminRole + assertSameOrigin + 审计。
 * 已作废码 redeemCode 会拒绝（status !== active）；启用后恢复可兑（仍受 maxUses/expiresAt 约束）。
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();
    const { id } = await ctx.params;

    const body = (await req.json()) as { action?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "disable" && action !== "enable") return fail("action 仅支持 disable / enable");

    const rc = await prisma.redemptionCode.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!rc) return fail("兑换码不存在", 404);

    const nextStatus = action === "disable" ? "disabled" : "active";
    if (rc.status === nextStatus) return ok({ id, status: nextStatus, unchanged: true });

    await prisma.redemptionCode.update({ where: { id }, data: { status: nextStatus } });

    await audit({
      operatorId: admin.id,
      action: `redemption:${action}`,
      targetType: "redemption_code",
      targetId: id,
      detail: JSON.stringify({ from: rc.status, to: nextStatus }),
    }).catch(() => {});

    return ok({ id, status: nextStatus });
  });
}
