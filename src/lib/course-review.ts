/**
 * 课程评价聚合层（server-only · S5 评价系统闭环）
 * ------------------------------------------------------------------
 * 唯一一份「读真实 CourseReview → 聚合评分/分布/列表」的逻辑，供课程详情页、
 * 集市商品页、评价 API 复用，保证字段与口径完全一致。
 *
 * 兜底策略（诚实不冒充）：
 *   - 有真实评价（count > 0）：一律读真实数据，isPlaceholder=false，UI 不标「示例」。
 *   - 零评价：回退 deriveCourseRating 的确定性占位（同课稳定、SSR/CSR 一致），
 *     isPlaceholder=true，UI 标「示例」。这样新课在攒够真实评价前仍有体面的口碑预览，
 *     且随第一条真实评价落地即自动切换为真实聚合，调用点无需改动。
 *
 * 越权：本模块只做「按 courseId 聚合 / 列评价」的读，不涉及某用户私有数据；
 *   「我的评价」「我能否评价」由 API 层严格 where userId 处理（见 reviews 路由）。
 */

import "server-only";
import { prisma } from "@/lib/db";
import { deriveCourseRating } from "@/lib/course-rating";

/** 单条评价视图（列表展示用；不外泄 userId 之外的用户敏感字段）。 */
export interface CourseReviewView {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string; // ISO
  author: { id: string; nickname: string; avatarUrl: string | null };
}

/** 课程评分聚合：均分 + 评价数 + 1-5 星分布 + 是否占位。 */
export interface CourseRatingAggregate {
  /** 均分（一位小数）。零评价时为占位派生分。 */
  score: number;
  /** 评价条数。零评价时为占位派生数（非真实计数）。 */
  count: number;
  /** true=当前为占位派生（无真实评价）；false=读自真实评价。UI 据此决定是否标「示例」。 */
  isPlaceholder: boolean;
  /** 星级分布：dist[k] = 打 (k+1) 星的条数（索引 0→1 星 … 4→5 星）。占位时全 0。 */
  dist: [number, number, number, number, number];
}

/**
 * 聚合某课的真实评分（均分 + 分布）。零评价回退占位派生。
 * @param courseId 课程 id。
 * @param learnersCount 在学人数（仅零评价占位派生时用到，与卡片口径一致）。
 */
export async function getCourseRatingAggregate(
  courseId: string,
  learnersCount: number,
): Promise<CourseRatingAggregate> {
  const rows = await prisma.courseReview.groupBy({
    by: ["rating"],
    where: { courseId },
    _count: { rating: true },
  });

  const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    const star = r.rating;
    if (star >= 1 && star <= 5) {
      const n = r._count.rating;
      dist[star - 1] = n;
      total += n;
      sum += star * n;
    }
  }

  // 零真实评价：回退确定性占位（诚实标「示例」）。
  if (total === 0) {
    const ph = deriveCourseRating(courseId, learnersCount);
    return { score: ph.score, count: ph.count, isPlaceholder: true, dist };
  }

  const score = Math.round((sum / total) * 10) / 10;
  return { score, count: total, isPlaceholder: false, dist };
}

/**
 * 批量聚合多门课的真实评分（一次 groupBy，避免集市列表 N+1）。
 * 只返回「有真实评价」的课的真实聚合；无评价的课不在 map 中，调用方对缺失键回退占位派生。
 * @param courseIds 课程 id 列表。
 * @returns Map<courseId, { score, count }>——仅含有真实评价的课。
 */
export async function batchCourseRealRatings(
  courseIds: string[],
): Promise<Map<string, { score: number; count: number }>> {
  const out = new Map<string, { score: number; count: number }>();
  if (courseIds.length === 0) return out;

  const rows = await prisma.courseReview.groupBy({
    by: ["courseId", "rating"],
    where: { courseId: { in: courseIds } },
    _count: { rating: true },
  });

  // 逐课累加 sum/total，再算均分。
  const acc = new Map<string, { sum: number; total: number }>();
  for (const r of rows) {
    if (r.rating < 1 || r.rating > 5) continue;
    const n = r._count.rating;
    const cur = acc.get(r.courseId) ?? { sum: 0, total: 0 };
    cur.sum += r.rating * n;
    cur.total += n;
    acc.set(r.courseId, cur);
  }
  for (const [courseId, { sum, total }] of acc) {
    if (total === 0) continue;
    out.set(courseId, { score: Math.round((sum / total) * 10) / 10, count: total });
  }
  return out;
}

/**
 * 列某课的真实评价（最新在前，默认取前 N 条）。零评价返回空数组。
 * 只暴露作者的公开展示字段（id/nickname/avatarUrl）。
 */
export async function listCourseReviews(
  courseId: string,
  limit = 20,
): Promise<CourseReviewView[]> {
  const rows = await prisma.courseReview.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    author: { id: r.user.id, nickname: r.user.nickname, avatarUrl: r.user.avatarUrl },
  }));
}

/**
 * 取当前用户对某课的既有评价（越权铁律：严格 where userId=我）。
 * 用于详情页「写评价」入口的初始态（已评过→回填 + 改为「修改评价」）。
 * @returns 我的评价（若有）或 null。
 */
export async function getMyCourseReview(
  courseId: string,
  userId: string,
): Promise<{ rating: number; comment: string | null } | null> {
  const mine = await prisma.courseReview.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { rating: true, comment: true },
  });
  return mine ? { rating: mine.rating, comment: mine.comment } : null;
}

/**
 * 当前用户是否学过该课（有任一 LearningProgress 即算）——评价资格判定。
 * 越权铁律：严格 where userId=我。API 与详情页共用此判定，口径一致。
 */
export async function hasLearnedCourse(courseId: string, userId: string): Promise<boolean> {
  const row = await prisma.learningProgress.findFirst({
    where: { userId, courseId },
    select: { id: true },
  });
  return Boolean(row);
}
