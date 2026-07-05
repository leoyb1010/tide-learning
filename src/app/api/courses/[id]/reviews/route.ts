import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { requireUser, getCurrentUser } from "@/lib/session";
import { canViewCourse } from "@/lib/queries";
import {
  getCourseRatingAggregate,
  listCourseReviews,
  hasLearnedCourse,
  getMyCourseReview,
} from "@/lib/course-review";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** id 或 slug 解析为课，附可见性所需字段。他人私有课→null（越权读取修复，与 getCourseDetail 同门）。 */
async function resolveViewableCourse(idOrSlug: string, viewerId: string | null) {
  const course = await prisma.course.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: { id: true, origin: true, authorUserId: true, sharedStatus: true, learnersCount: true },
  });
  if (!course) return null;
  if (!canViewCourse(course, viewerId)) return null;
  return course;
}

/**
 * GET /api/courses/:id/reviews —— 课程评价聚合 + 列表。
 * 游客可读（评价是公开口碑）。返回真实聚合（无评价则占位派生，isPlaceholder=true）、
 * 评价列表、以及登录用户自己的既有评价与可评资格（越权铁律：严格 where userId=我）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await getCurrentUser();
    const course = await resolveViewableCourse(id, user?.id ?? null);
    if (!course) return fail("课程不存在", 404);

    const [aggregate, reviews] = await Promise.all([
      getCourseRatingAggregate(course.id, course.learnersCount),
      listCourseReviews(course.id, 20),
    ]);

    // 登录用户额外返回：我的既有评价 + 是否学过（可评资格）。越权铁律：where userId=我。
    let mine: { rating: number; comment: string | null } | null = null;
    let canReview = false;
    if (user) {
      [mine, canReview] = await Promise.all([
        getMyCourseReview(course.id, user.id),
        hasLearnedCourse(course.id, user.id),
      ]);
    }

    return ok({ aggregate, reviews, mine, canReview });
  });
}

/**
 * POST /api/courses/:id/reviews —— 提交/修改评价（一人一课一评，upsert）。
 * 资格：requireUser + assertSameOrigin(A2 CSRF) + 学过才可评（有该课 LearningProgress）。
 * 越权铁律：评价强制 userId=当前用户；upsert 唯一键 (userId, courseId) 天然隔离他人评价。
 * 幂等：重复提交覆盖旧评价（不刷条数、不刷分），符合「一人一课一评」语义。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    const { id } = await params;

    const course = await resolveViewableCourse(id, user.id);
    if (!course) return fail("课程不存在", 404);

    // 资格：学过才可评（有该课学习记录）。越权铁律：where userId=我。
    const learned = await hasLearnedCourse(course.id, user.id);
    if (!learned) return fail("学过这门课才能评价，先去学一节吧", 403);

    // 防刷：单用户对评价写入按小时限流（改评也算一次写）。
    assertUserRateLimit(user.id, "course_review", 20, 3_600_000);

    const body = (await req.json().catch(() => null)) as { rating?: number; comment?: string } | null;
    const ratingRaw = Number(body?.rating);
    if (!Number.isFinite(ratingRaw)) return fail("请选择评分");
    const rating = Math.round(ratingRaw);
    if (rating < 1 || rating > 5) return fail("评分需在 1 到 5 星之间");

    const commentRaw = body?.comment?.trim() ?? "";
    if (commentRaw.length > 500) return fail("评价过长，请精简到 500 字以内");
    const comment = commentRaw.length > 0 ? commentRaw : null;

    // 一人一课一评：upsert（唯一键 userId_courseId）。userId 强制取当前用户，杜绝越权改他人评价。
    await prisma.courseReview.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      create: { userId: user.id, courseId: course.id, rating, comment },
      update: { rating, comment },
    });

    await track({ eventName: "course_review", userId: user.id, properties: { course_id: course.id, rating } });

    // 回传最新聚合，前端可立即刷新星级/分布，无需二次请求。
    const [aggregate, reviews] = await Promise.all([
      getCourseRatingAggregate(course.id, course.learnersCount),
      listCourseReviews(course.id, 20),
    ]);
    return ok({ aggregate, reviews, mine: { rating, comment } });
  });
}
