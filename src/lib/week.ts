/** ISO 周 key，用于投票周票额（§6.6：每周一 00:00 重置）。 */
export function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const WEEKLY_VOTE_BUDGET = 5; // §6.6：每订阅用户每周 5 票
export const MAX_VOTES_PER_DEMAND = 3; // §6.6：同一需求最多 3 票
