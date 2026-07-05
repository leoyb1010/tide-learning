/**
 * SRS（间隔重复）调度 —— 纯函数版（流3-U3）。
 *
 * 本文件把 `/api/ai/review-card` PATCH 里内联的「简化 SM-2」调度逻辑抽成纯函数，
 * 便于单测与后续升级 FSRS。**行为与 route 原实现逐字节等价**，不改变任何调度语义：
 *   - 记得：ease += 0.1（上限 2.8）；首次（间隔 0）记得 → 1 天，
 *           之后 intervalDays = max(1, round(旧间隔 × 新 ease))。
 *   - 忘了：ease -= 0.2（下限 1.3）；intervalDays 重置为 1。
 *   - dueAt = now + intervalDays 天。
 *
 * 纯函数：不读时钟、不碰 DB。`now` 由调用方注入（默认 Date.now()），使测试可控。
 */

/** 一天的毫秒数（与 review-card route 的 DAY_MS 一致）。 */
export const DAY_MS = 86_400_000;

/** ease 上下限与初始值（简化 SM-2 常量）。 */
export const EASE_DEFAULT = 2.5;
export const EASE_MAX = 2.8;
export const EASE_MIN = 1.3;
export const EASE_UP = 0.1;
export const EASE_DOWN = 0.2;

/** 调度所需的卡片当前状态（只取调度相关字段，便于从任意来源构造）。 */
export interface SchedulableCard {
  /** 当前难度系数；缺省/为空按 EASE_DEFAULT 处理（与 route 的 `card.ease ?? 2.5` 一致）。 */
  ease?: number | null;
  /** 当前间隔天数（首次为 0）。 */
  intervalDays: number;
}

/** 调度结果：下一轮的 ease / 间隔 / 到期时刻。 */
export interface ScheduleResult {
  /** 更新后的难度系数。 */
  ease: number;
  /** 更新后的间隔天数。 */
  intervalDays: number;
  /** 下次到期时刻（now + intervalDays 天）。 */
  dueAt: Date;
}

/**
 * 计算复习后的下一轮调度（简化 SM-2，纯函数）。
 *
 * @param card       卡片当前状态（ease/intervalDays）。
 * @param remembered 本次是否「记得」。
 * @param now        当前时刻毫秒（默认 Date.now()）——注入以便测试确定化。
 * @returns          { ease, intervalDays, dueAt }。
 */
export function scheduleNext(
  card: SchedulableCard,
  remembered: boolean,
  now: number = Date.now(),
): ScheduleResult {
  let ease = card.ease ?? EASE_DEFAULT;
  let intervalDays: number;
  if (remembered) {
    ease = Math.min(EASE_MAX, ease + EASE_UP);
    // 首次（间隔 0）记得 → 1 天；之后翻倍并乘以 ease 系数（简化 SM-2）
    intervalDays = card.intervalDays > 0 ? Math.max(1, Math.round(card.intervalDays * ease)) : 1;
  } else {
    ease = Math.max(EASE_MIN, ease - EASE_DOWN);
    intervalDays = 1; // 忘了 → 重置为 1 天
  }
  const dueAt = new Date(now + intervalDays * DAY_MS);
  return { ease, intervalDays, dueAt };
}
