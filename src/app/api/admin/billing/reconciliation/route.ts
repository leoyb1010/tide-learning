import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { assertSameOrigin, fail, handle, ok } from "@/lib/api";

/**
 * Finance-only queue for provider calls whose real usage could not be
 * confirmed. Resolving/waiving is explicit, reasoned, and audited; there is
 * no endpoint that silently deletes a pending financial record.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requirePermission("order:refund");
    const status = req.nextUrl.searchParams.get("status") || "pending";
    if (!["pending", "resolved", "waived"].includes(status)) return fail("对账状态无效");
    const items = await prisma.llmBillingReconciliation.findMany({
      where: { status },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true, reservationId: true, userId: true, scene: true,
        reasonCode: true, providerStatus: true, providerRequestId: true,
        usageJson: true, status: true, createdAt: true, resolvedAt: true,
      },
    });
    return ok({ items });
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("order:refund");
    assertSameOrigin(req);
    const body = (await req.json()) as { id?: string; status?: string; reason?: string };
    const id = body.id?.trim();
    const status = body.status?.trim();
    const reason = body.reason?.trim();
    if (!id || (status !== "resolved" && status !== "waived")) return fail("请提供有效的对账记录和处理状态");
    if (!reason || reason.length < 8 || reason.length > 500) return fail("处理原因需为 8 到 500 个字符");

    const current = await prisma.llmBillingReconciliation.findUnique({ where: { id } });
    if (!current) return fail("对账记录不存在", 404);
    if (current.status !== "pending") return fail("该对账记录已经处理", 409);

    const item = await prisma.llmBillingReconciliation.update({
      where: { id },
      data: { status, resolvedAt: new Date() },
      select: { id: true, status: true, resolvedAt: true },
    });
    await audit({
      operatorId: admin.id,
      action: `billing_reconciliation.${status}`,
      targetType: "llm_billing_reconciliation",
      targetId: id,
      detail: reason,
    });
    return ok({ item });
  });
}
