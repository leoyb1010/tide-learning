import { NextRequest } from "next/server";
import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveEntitlement } from "@/lib/entitlement";
import { getBalance } from "@/lib/credits";
import { getGamificationSummary } from "@/lib/gamification";
import { getAuthorEarnings } from "@/lib/credit-trade";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/overview —— 成长档案聚合端点（v3.2，供 iOS/Mac 客户端一次拉全）。
 *
 * Web 的 /me 页是 Server Component 直查 Prisma，原生端拿不到，故收敛为一个只读端点：
 * 数据总览条（时长/完课/笔记/连续/成就/积分）+ 学习资产（笔记本/已购）+ 复习 + 创作者收益摘要。
 * 越权铁律：全部 where userId。契约保护：字段进 contract-smoke。
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const now = new Date();

    const [
      snapshot,
      progressAgg,
      completedCount,
      notesCount,
      notebookCount,
      purchasedCount,
      dueReviewCount,
      gamification,
      balance,
      earnings,
    ] = await Promise.all([
      resolveEntitlement(user.id),
      prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
      prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }),
      prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
      prisma.notebook.count({ where: { userId: user.id } }),
      prisma.coursePurchase.count({ where: { userId: user.id } }),
      prisma.reviewCard.count({ where: { userId: user.id, dueAt: { lte: now } } }),
      getGamificationSummary(user.id),
      getBalance(user.id),
      getAuthorEarnings(user.id),
    ]);

    return ok({
      // 数据总览条
      totalStudySec: progressAgg._sum.progressSec ?? 0,
      completedCount,
      notesCount,
      notebookCount,
      purchasedCount,
      dueReviewCount,
      currentStreak: gamification.currentStreak,
      longestStreak: gamification.longestStreak,
      achievementsCount: gamification.achievements.length,
      creditBalance: balance,
      // 会员状态（原生端学生证/顶栏可直接消费，避免再打 entitlement 端点）
      isSubscriber: snapshot.isSubscriber,
      subscriptionStatus: snapshot.subscriptionStatus,
      statusLabel: snapshot.statusLabel,
      validUntil: snapshot.validUntil,
      // 创作者收益摘要（无在架课时 stallCount=0，客户端据此隐藏）
      creator: {
        totalIncome: earnings.totalIncome,
        totalSales: earnings.totalSales,
        stallCount: earnings.courses.length,
      },
    });
  });
}
