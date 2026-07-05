/**
 * 课程评分 · 占位派生（纯函数，server/client 通用）
 * ------------------------------------------------------------------
 * 现状：schema 尚无真实评价系统（ReviewCard 是复习卡，非课程评价）。
 * 完整评价系统（用户打分 + 文字评价 + 聚合）排期 S5。
 *
 * 在此之前，课程库气泡卡 / 详情页头区需要一个「评分星级 + 评价数」来完成
 * 商业化预览体验。为避免每次渲染跳数、也避免 SSR/CSR 不一致导致水合报错，
 * 这里用课程稳定字段（id + learnersCount）做确定性派生：同一门课永远同一个分。
 *
 * 返回对象带 isPlaceholder: true，调用方据此在 UI 上标注「示例评分」，
 * 不冒充真实数据。真实字段就位后（S5），把本模块换成读 course.rating 即可，
 * 调用点签名不变。
 */

export interface CourseRating {
  /** 4.6 – 4.9 之间的一位小数评分（占位派生，稳定） */
  score: number;
  /** 评价条数（占位派生，与在学人数弱相关，稳定） */
  count: number;
  /** 恒为 true：提醒 UI 标注「示例/占位」，评价系统 S5 落地 */
  isPlaceholder: true;
}

/** 稳定字符串散列（djb2 变体），确定性、无随机。 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0; // 转无符号
}

/**
 * 由课程 id 与在学人数派生占位评分。
 * - score 落在 4.6–4.9（高分区间，符合精选课程语境；不给满分显得更可信）
 * - count 与在学人数弱相关（约 3%–6%），最低给个体面的下限
 * 纯确定性：入参相同则输出恒定，SSR/CSR 一致，不会水合错位。
 */
export function deriveCourseRating(courseId: string, learnersCount: number): CourseRating {
  const h = hashString(courseId);
  // 4.6 + [0..3]*0.1 → {4.6, 4.7, 4.8, 4.9}
  const score = 4.6 + (h % 4) * 0.1;

  // 评价数：在学人数的 3%–6%（由散列决定具体比例），最低 24 条兜底。
  const ratio = 0.03 + ((h >> 5) % 30) / 1000; // 0.030 – 0.059
  const raw = Math.round(learnersCount * ratio);
  const count = Math.max(24, raw);

  return { score: Math.round(score * 10) / 10, count, isPlaceholder: true };
}
