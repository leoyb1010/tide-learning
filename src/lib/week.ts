/**
 * 投票周界与潮汐日历日期工具。
 * A1-3 修复：投票周界以 Asia/Shanghai（UTC+8，中国无夏令时）计算，
 * 保证"每周一 00:00 (北京时间) 重置"与用户直觉一致。
 */

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

/** 把任意时刻转换为「上海本地」的日期部件（用 UTC getter 读取偏移后的时间）。 */
function toShanghai(date: Date): Date {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS);
}

/** 上海时区的 YYYY-MM-DD（潮汐日历、streak 用）。 */
export function shanghaiDayKey(date = new Date()): string {
  const s = toShanghai(date);
  const y = s.getUTCFullYear();
  const m = String(s.getUTCMonth() + 1).padStart(2, "0");
  const d = String(s.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * ISO-8601 周 key（周一为一周第一天），但以上海本地时间判定。
 * §6.6：每周一 00:00（北京时间）重置。
 */
export function weekKey(date = new Date()): string {
  const s = toShanghai(date);
  // 以「上海本地」的 Y/M/D 构造一个纯日期（用 UTC 基准做 ISO 周运算）
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 移到本周周四
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 距离下一次周界重置（下周一 00:00 上海时间）的毫秒数，用于前端倒计时。 */
export function msUntilWeekReset(date = new Date()): number {
  const s = toShanghai(date);
  const dayNum = (s.getUTCDay() + 6) % 7; // 周一=0
  const daysUntilNextMonday = 7 - dayNum;
  // 下周一 00:00（上海本地）对应的 UTC 时刻
  const nextMondayShanghai = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + daysUntilNextMonday),
  );
  const nextMondayUtcMs = nextMondayShanghai.getTime() - SHANGHAI_OFFSET_MS;
  return Math.max(0, nextMondayUtcMs - date.getTime());
}

export const WEEKLY_VOTE_BUDGET = 5; // §6.6：每订阅用户每周 5 票
export const MAX_VOTES_PER_DEMAND = 3; // §6.6：同一需求最多 3 票
