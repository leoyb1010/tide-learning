import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/dashboard — 运营数据看板（§8.2.5，P1 十项指标）
export async function GET() {
  return handle(async () => {
    await requirePermission("dashboard:read");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayViews,
      registers,
      trials,
      subscriptions,
      checkoutStarts,
      playSeconds,
      notesCount,
      demandsCount,
      votesCount,
      refunds,
    ] = await Promise.all([
      prisma.analyticsEvent.count({ where: { eventName: "homepage_view", createdAt: { gte: today } } }),
      prisma.user.count({ where: { role: "user" } }),
      prisma.analyticsEvent.count({ where: { eventName: "lesson_trial_start" } }),
      prisma.subscription.count({ where: { status: { in: ["active", "trial", "grace_period", "canceled_but_active"] } } }),
      prisma.analyticsEvent.count({ where: { eventName: "checkout_start" } }),
      prisma.learningProgress.aggregate({ _sum: { progressSec: true } }),
      prisma.note.count({ where: { deletedAt: null } }),
      prisma.demand.count(),
      prisma.demandVote.aggregate({ _sum: { voteCount: true } }),
      prisma.order.count({ where: { status: "refunded" } }),
    ]);

    const subConversion = checkoutStarts > 0 ? Math.round((subscriptions / Math.max(registers, 1)) * 1000) / 10 : 0;

    return ok({
      metrics: {
        todayViews,
        registers,
        trials,
        subscriptions,
        subConversionRate: subConversion, // 注册→订阅 %
        playHours: Math.round(((playSeconds._sum.progressSec ?? 0) / 3600) * 10) / 10,
        notesCount,
        demandsCount,
        votesCount: votesCount._sum.voteCount ?? 0,
        refunds,
      },
    });
  });
}
