import { prisma } from "./db";
import { shanghaiDayKey } from "./week";

/**
 * 学习周报（留存回路）—— 纯服务端聚合函数。
 *
 * 从潮汐日历（StreakDay：day/minutes/notes，Asia/Shanghai 日键）派生
 * 「本周（周一→周日）」与「上周」两段数据，并给出本周 vs 上周的增减对比。
 * 完课数按 LearningProgress.completedAt 落在本周区间内统计。
 * 「最高连击」= 本周内连续有学习活动（minutes>0）的最长天数段（真正的「连击」语义）。
 *
 * 架构：本文件是 server lib（引 prisma / week 工具），只在服务端组件/路由调用。
 * 越权铁律：所有查询恒带 where userId，只读本人数据。
 */

/** 本周内某一天的水位（周一→周日顺序）。 */
export interface WeeklyReportDay {
  /** "YYYY-MM-DD"（Asia/Shanghai）。 */
  day: string;
  /** 当日学习分钟。 */
  minutes: number;
  /** 当日新增笔记数。 */
  notes: number;
  /** 是否为今天（书桌高亮当前柱）。 */
  isToday: boolean;
  /** 是否为未来（本周尚未到来的日子，柱图留空）。 */
  isFuture: boolean;
}

/** 一个数值指标的本周值 + 相对上周的增减。 */
export interface WeeklyDelta {
  /** 本周值。 */
  value: number;
  /** 上周值。 */
  prev: number;
  /** 本周 - 上周（可正可负，上周为 0 时即等于本周值）。 */
  delta: number;
}

export interface WeeklyReport {
  /** ISO 周标签（如 "2026-W27"），供文案/分享参数用。 */
  weekLabel: string;
  /** 本周起始（周一）日键 "YYYY-MM-DD"。 */
  weekStart: string;
  /** 本周结束（周日）日键 "YYYY-MM-DD"。 */
  weekEnd: string;
  /** 7 天逐日水位（周一→周日）。 */
  days: WeeklyReportDay[];
  /** 本周学习分钟（vs 上周）。 */
  minutes: WeeklyDelta;
  /** 本周活跃天数（有学习分钟的天，vs 上周）。 */
  activeDays: WeeklyDelta;
  /** 本周新增笔记（vs 上周）。 */
  notes: WeeklyDelta;
  /** 本周完课数（completedAt 落在本周，vs 上周）。 */
  completed: WeeklyDelta;
  /** 本周新增错题数（ExamMistake.createdAt 落在本周，vs 上周）。 */
  mistakes: WeeklyDelta;
  /** 本周最高连击（连续活跃天数的最长段，vs 上周）。 */
  bestStreak: WeeklyDelta;
  /** 本周单日最高分钟（峰值日，柱图基准与「巅峰日」文案用）。 */
  peakMinutes: number;
  /** 本周是否已有任何学习活动（用于空态文案分支）。 */
  hasActivity: boolean;
}

/** 以「本地日键」为基准做加减天，返回 "YYYY-MM-DD"。避免时区漂移（纯字符串→本地 Date→回字符串）。 */
function shiftDayKey(baseKey: string, deltaDays: number): string {
  const [y, m, d] = baseKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

/** 上海本地「周一=0」的星期序（0..6）。 */
function localMondayIndex(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** 计算一段逐日 minutes 序列中「连续有活动」的最长段（最高连击）。 */
function longestActiveRun(minutesByDay: number[]): number {
  let best = 0;
  let run = 0;
  for (const min of minutesByDay) {
    if (min > 0) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** 把「本周一日键」+ 一张 day→{minutes,notes} 表，聚合成一周的四项和值与峰值。 */
function summarizeWeek(
  weekStartKey: string,
  cal: Map<string, { minutes: number; notes: number }>,
) {
  const minutesByDay: number[] = [];
  let minutes = 0;
  let notes = 0;
  let activeDays = 0;
  let peakMinutes = 0;
  for (let i = 0; i < 7; i++) {
    const key = shiftDayKey(weekStartKey, i);
    const rec = cal.get(key);
    const min = rec?.minutes ?? 0;
    minutesByDay.push(min);
    minutes += min;
    notes += rec?.notes ?? 0;
    if (min > 0) activeDays += 1;
    if (min > peakMinutes) peakMinutes = min;
  }
  return {
    minutes,
    notes,
    activeDays,
    peakMinutes,
    bestStreak: longestActiveRun(minutesByDay),
    minutesByDay,
  };
}

/** 组装一个 delta（value=本周，prev=上周）。 */
function toDelta(value: number, prev: number): WeeklyDelta {
  return { value, prev, delta: value - prev };
}

/**
 * 生成用户本周学习周报（含 vs 上周对比）。
 *
 * @param userId 目标用户（调用方保证已鉴权）。
 */
export async function getWeeklyReport(userId: string): Promise<WeeklyReport> {
  const todayKey = shanghaiDayKey();
  const todayIdx = localMondayIndex(todayKey);
  const weekStart = shiftDayKey(todayKey, -todayIdx); // 本周一
  const weekEnd = shiftDayKey(weekStart, 6); // 本周日
  const prevWeekStart = shiftDayKey(weekStart, -7); // 上周一
  const prevWeekEnd = shiftDayKey(weekStart, -1); // 上周日

  // 潮汐日历：一次取全 14 天窗口（上周一→本周日），字符串字典序过滤即可。
  const dayRows = await prisma.streakDay.findMany({
    where: { userId, day: { gte: prevWeekStart, lte: weekEnd } },
    select: { day: true, minutes: true, notes: true },
  });
  const cal = new Map(dayRows.map((r) => [r.day, { minutes: r.minutes, notes: r.notes }]));

  const thisWeek = summarizeWeek(weekStart, cal);
  const prevWeek = summarizeWeek(prevWeekStart, cal);

  // 完课数：completedAt 落在各自周区间内。区间用「本周一 00:00」到「下周一 00:00」的
  // 上海本地时刻换算成 UTC Date 传给 Prisma（DateTime 存 UTC）。
  const thisStart = shanghaiMidnightUtc(weekStart);
  const thisEnd = shanghaiMidnightUtc(shiftDayKey(weekStart, 7));
  const prevStart = shanghaiMidnightUtc(prevWeekStart);
  const prevEnd = thisStart; // 上周结束即本周开始
  // 错题数：ExamMistake.createdAt 落在各自周区间内（与完课数同区间口径）。
  const [completedThis, completedPrev, mistakesThis, mistakesPrev] = await Promise.all([
    prisma.learningProgress.count({
      where: { userId, completedAt: { gte: thisStart, lt: thisEnd } },
    }),
    prisma.learningProgress.count({
      where: { userId, completedAt: { gte: prevStart, lt: prevEnd } },
    }),
    prisma.examMistake.count({
      where: { userId, createdAt: { gte: thisStart, lt: thisEnd } },
    }),
    prisma.examMistake.count({
      where: { userId, createdAt: { gte: prevStart, lt: prevEnd } },
    }),
  ]);

  const days: WeeklyReportDay[] = thisWeek.minutesByDay.map((minutes, i) => {
    const key = shiftDayKey(weekStart, i);
    const rec = cal.get(key);
    return {
      day: key,
      minutes,
      notes: rec?.notes ?? 0,
      isToday: key === todayKey,
      isFuture: key > todayKey,
    };
  });

  return {
    weekLabel: isoWeekLabel(weekStart),
    weekStart,
    weekEnd,
    days,
    minutes: toDelta(thisWeek.minutes, prevWeek.minutes),
    activeDays: toDelta(thisWeek.activeDays, prevWeek.activeDays),
    notes: toDelta(thisWeek.notes, prevWeek.notes),
    completed: toDelta(completedThis, completedPrev),
    mistakes: toDelta(mistakesThis, mistakesPrev),
    bestStreak: toDelta(thisWeek.bestStreak, prevWeek.bestStreak),
    peakMinutes: thisWeek.peakMinutes,
    hasActivity: thisWeek.minutes > 0 || thisWeek.notes > 0,
  };
}

/** 某个上海本地日键的「当日 00:00（上海）」对应的 UTC 时刻。 */
function shanghaiMidnightUtc(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  // 上海 UTC+8：本地 00:00 == 前一日 UTC 16:00。
  return new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000);
}

/** 以本周一日键推导 ISO-8601 周标签（"YYYY-Www"，周一为一周首日）。 */
function isoWeekLabel(mondayKey: string): string {
  const [y, m, d] = mondayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 3); // 移到本周周四（ISO 周含周四的年份即周年份）
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
