import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/dashboard — 运营数据看板（§8.2.5，P1 十项指标）
export async function GET() {
  return handle(async () => {
    await requirePermission("dashboard:read");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const premiumStatuses = ["active", "trial", "grace_period", "canceled_but_active"];

    const [
      todayViews,
      registers,
      trials,
      activeSubscriptions,
      checkoutStarts,
      weeklyLearners,
      notesCount,
      demandsCount,
      votesCount,
      refunds,
    ] = await Promise.all([
      prisma.analyticsEvent.count({ where: { eventName: "homepage_view", createdAt: { gte: today } } }),
      prisma.user.count({ where: { role: "user" } }),
      prisma.analyticsEvent.count({ where: { eventName: "lesson_trial_start" } }),
      prisma.subscription.findMany({ where: { status: { in: premiumStatuses } }, distinct: ["userId"], select: { userId: true } }),
      prisma.analyticsEvent.count({ where: { eventName: "checkout_start" } }),
      prisma.learningProgress.findMany({ where: { lastPlayedAt: { gte: weekAgo } }, distinct: ["userId"], select: { userId: true } }),
      prisma.note.count({ where: { deletedAt: null } }),
      prisma.demand.count(),
      prisma.demandVote.aggregate({ _sum: { voteCount: true } }),
      prisma.order.count({ where: { status: "refunded" } }),
    ]);

    const activeSubscriberIds = new Set(activeSubscriptions.map((s) => s.userId));
    const subscriptions = activeSubscriberIds.size;
    const weeklyActivePaidLearners = new Set(weeklyLearners.filter((p) => activeSubscriberIds.has(p.userId)).map((p) => p.userId)).size;
    const subConversion = Math.round((subscriptions / Math.max(registers, 1)) * 1000) / 10;

    return ok({
      metrics: {
        todayViews,
        registers,
        trials,
        subscriptions,
        subConversionRate: subConversion, // 注册→订阅 %
        weeklyActivePaidLearners,
        notesCount,
        demandsCount,
        votesCount: votesCount._sum.voteCount ?? 0,
        refunds,
      },
    });
  });
}
