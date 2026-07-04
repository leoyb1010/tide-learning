import { prisma } from "./db";
import { shanghaiDayKey } from "./week";

/**
 * C3：学习激励 —— 连续学习(streak) + 潮汐日历 + 成就徽章。
 * 轻量、不做强制打卡（符合计划书 §2.3「不做复杂游戏化」）。
 */

/** 记录一次「今日有学习活动」，更新 streak 与潮汐日历水位。 */
export async function recordActivity(userId: string, opts: { minutes?: number; notes?: number } = {}) {
  const today = shanghaiDayKey();
  const minutes = Math.max(0, Math.round(opts.minutes ?? 0));
  const notes = Math.max(0, Math.round(opts.notes ?? 0));

  // 当日水位（潮汐日历一格）
  await prisma.streakDay.upsert({
    where: { userId_day: { userId, day: today } },
    create: { userId, day: today, minutes, notes },
    update: { minutes: { increment: minutes }, notes: { increment: notes } },
  });

  // 连续天数
  const streak = await prisma.streak.findUnique({ where: { userId } });
  const yesterday = shanghaiDayKey(new Date(Date.now() - 864e5));
  if (!streak) {
    await prisma.streak.create({ data: { userId, currentStreak: 1, longestStreak: 1, lastActiveDay: today } });
  } else if (streak.lastActiveDay === today) {
    // 今日已计数，不变
  } else {
    const next = streak.lastActiveDay === yesterday ? streak.currentStreak + 1 : 1;
    await prisma.streak.update({
      where: { userId },
      data: { currentStreak: next, longestStreak: Math.max(next, streak.longestStreak), lastActiveDay: today },
    });
    if (next >= 7) await unlockAchievement(userId, "week_streak").catch(() => {});
  }
}

/** 解锁成就（幂等）。成就未在库中定义时静默跳过。 */
export async function unlockAchievement(userId: string, key: string) {
  const ach = await prisma.achievement.findUnique({ where: { key } });
  if (!ach) return;
  await prisma.userAchievement.upsert({
    where: { userId_achievementId: { userId, achievementId: ach.id } },
    create: { userId, achievementId: ach.id },
    update: {},
  });
}

/**
 * 年视图热力数据：取近 365 天的每日学习水位（StreakDay：day/minutes/notes）。
 * StreakDay.day 为 "YYYY-MM-DD"（Asia/Shanghai），可按字符串字典序过滤。
 * 越权铁律：where 恒带 userId，只读本人数据。
 */
export async function getYearHeatmap(userId: string) {
  const todayKey = shanghaiDayKey();
  // 366 天窗口（含今日），覆盖 53 周网格所需的完整年段
  const sinceKey = shanghaiDayKey(new Date(Date.now() - 365 * 864e5));
  const days = await prisma.streakDay.findMany({
    where: { userId, day: { gte: sinceKey, lte: todayKey } },
    select: { day: true, minutes: true, notes: true },
    orderBy: { day: "asc" },
  });
  return {
    todayKey,
    days: days.map((d) => ({ day: d.day, minutes: d.minutes, notes: d.notes })),
  };
}

/** 读取用户激励概览（周报 / 我的 页用）。 */
export async function getGamificationSummary(userId: string) {
  const [streak, days, achievements] = await Promise.all([
    prisma.streak.findUnique({ where: { userId } }),
    prisma.streakDay.findMany({ where: { userId }, orderBy: { day: "desc" }, take: 90 }),
    prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true }, orderBy: { unlockedAt: "desc" } }),
  ]);
  return {
    currentStreak: streak?.currentStreak ?? 0,
    longestStreak: streak?.longestStreak ?? 0,
    calendar: days.map((d) => ({ day: d.day, minutes: d.minutes, notes: d.notes })),
    achievements: achievements.map((a) => ({
      key: a.achievement.key, name: a.achievement.name,
      description: a.achievement.description, icon: a.achievement.icon,
      unlockedAt: a.unlockedAt.toISOString(),
    })),
  };
}
