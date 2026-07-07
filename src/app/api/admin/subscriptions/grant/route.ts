import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/session";
import { activateMembershipDays, resolveGrantPlan } from "@/lib/payment";
import { resolveAdminTargetUser } from "@/lib/admin-users";
import { resolveEntitlement } from "@/lib/entitlement";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/subscriptions/grant — 管理员赠送会员（按天数或月数）。
 * 高危 → requireAdminRole + assertSameOrigin + 审计。
 * 复用 payment.activateMembershipDays（与 iap/verify 的订阅激活/续期同一核心）+ resolveGrantPlan 挂套餐。
 * body: { userId? | email? | nickname?, days? | months?, planId?, reason? }。
 * days 与 months 二选一（months 折算 30 天/月）；channel 记为 "admin_grant"。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();

    const body = (await req.json()) as {
      userId?: unknown; email?: unknown; nickname?: unknown;
      days?: unknown; months?: unknown; planId?: unknown; reason?: unknown;
    };
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    const planId = typeof body.planId === "string" && body.planId.trim() ? body.planId.trim() : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    // days 优先；否则 months*30。二者都缺或非正 → 拒绝。
    let days = typeof body.days === "number" ? Math.trunc(body.days) : NaN;
    if (!Number.isFinite(days)) {
      const months = typeof body.months === "number" ? Math.trunc(body.months) : NaN;
      if (Number.isFinite(months)) days = months * 30;
    }
    if (!Number.isFinite(days) || days <= 0) return fail("请提供正整数的会员天数（days）或月数（months）");
    if (days > 3650) return fail("单次赠送时长过长（≤3650 天）");

    const target = await resolveAdminTargetUser({ userId, email, nickname });
    if ("error" in target) return fail(target.error, target.status);

    // 挑套餐（指定或默认全站最低价）——Subscription 必须挂 planId。
    const plan = await resolveGrantPlan(planId);

    const subId = await prisma.$transaction((tx) =>
      activateMembershipDays(tx, {
        userId: target.id,
        planId: plan.id,
        channel: "admin_grant",
        days,
        scope: plan.scope,
        priceSnapshotCents: plan.priceCents,
      }),
    );

    // 事务外刷新权益快照（对齐 iap/verify）。
    const entitlement = await resolveEntitlement(target.id);

    await audit({
      operatorId: admin.id,
      action: "subscription_grant",
      targetType: "user",
      targetId: target.id,
      detail: JSON.stringify({ days, planId: plan.id, planName: plan.name, reason: reason || null }),
    }).catch(() => {});

    return ok({
      userId: target.id,
      nickname: target.nickname,
      days,
      planName: plan.name,
      validUntil: entitlement.validUntil,
      subscriptionId: subId,
    });
  });
}
