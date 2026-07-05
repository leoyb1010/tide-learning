/**
 * 集市数据层（server-only）：把「查已上架课 + 聚合拿走数 + 我拿走过哪些 + 摊主信息」
 * 组装成 MarketStall[] 的**唯一一份**逻辑。Web server page（/market）与
 * iOS API（GET /api/market）都调本函数，保证字段与语义完全一致。
 *
 * 铁律：
 *   - 拿走数（collectCount）= 有该课学习记录的去重用户数，**排除作者本人**
 *     （与 collect 端点禁自收藏一致，与 Web 集市页上轮修的逻辑一致）。
 *   - 「我是否已拥有」以 CoursePurchase（所有权真值源）判定，严格 where userId=当前用户（越权铁律）；
 *     游客传 null 时跳过。免费预览进度（LearningProgress）不再算「已拥有」。
 */

import { prisma } from "@/lib/db";
import { marketStallCoverSrc } from "@/lib/tracks";
import { sellerBadge, type MarketStall } from "@/lib/market-view";
import { deriveCourseRating } from "@/lib/course-rating";
import {
  getCourseRatingAggregate,
  batchCourseRealRatings,
  type CourseRatingAggregate,
} from "@/lib/course-review";

/** 集市取货上限（与原 Web page 的 take:60 一致）。 */
const MARKET_TAKE = 60;

/**
 * 拼装集市摊位视图模型。
 * @param viewerId 当前登录用户 id；游客传 null（仍可看集市，只是 collectedByMe/mine 恒 false）。
 * @returns 摊位数组，顺序为 lastUpdatedAt desc（排序交给 sortStalls 派生，本函数只出原始集合）。
 */
export async function buildMarketStalls(viewerId: string | null): Promise<MarketStall[]> {
  // 已上架课：作者归属 + 学习人数 + 上新时间。
  const courses = await prisma.course.findMany({
    where: { sharedStatus: "shared" },
    orderBy: { lastUpdatedAt: "desc" },
    take: MARKET_TAKE,
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      category: true,
      coverColor: true,
      origin: true,
      authorUserId: true,
      learnersCount: true,
      priceCredits: true,
      salesCount: true,
      createdAt: true,
    },
  });

  const courseIds = courses.map((c) => c.id);
  // 课 id → 作者 userId，用于「拿走数」聚合时排除作者本人。
  const courseAuthorMap = new Map(courses.map((c) => [c.id, c.authorUserId]));

  // 每门课「拿走数」= 有该课学习记录的去重用户数；作者本人学自己的 shared 课不计。
  const collectRows =
    courseIds.length > 0
      ? await prisma.learningProgress.groupBy({
          by: ["courseId", "userId"],
          where: { courseId: { in: courseIds } },
        })
      : [];
  const collectCountMap = new Map<string, number>();
  for (const r of collectRows) {
    if (r.userId === courseAuthorMap.get(r.courseId)) continue; // 跳过作者本人
    collectCountMap.set(r.courseId, (collectCountMap.get(r.courseId) ?? 0) + 1);
  }

  // 我拥有哪些课（所有权真值源 CoursePurchase；越权铁律：where userId=我）——决定 CTA 初始态
  // （已在书架/去学习 vs 购买按钮）。免费预览进度不再算「已拥有」。游客跳过。
  const myCollectedSet = new Set<string>();
  if (viewerId && courseIds.length > 0) {
    const mine = await prisma.coursePurchase.findMany({
      where: { userId: viewerId, courseId: { in: courseIds } },
      select: { courseId: true },
    });
    for (const r of mine) myCollectedSet.add(r.courseId);
  }

  // 作者昵称 + 头像（一次查完）。
  const authorIds = Array.from(
    new Set(courses.map((c) => c.authorUserId).filter((x): x is string => Boolean(x))),
  );
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, nickname: true, avatarUrl: true },
        })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  // 真实评分批量聚合（S5）：一次 groupBy 取所有课的真实均分/条数，避免 N+1。
  // 无真实评价的课不在 map 中，下方组装时回退 deriveCourseRating 占位派生（同课稳定）。
  const realRatingMap = await batchCourseRealRatings(courseIds);

  // 摊主等级派生：按「摊主在本集市所有摊位的累计被拿走数」分档（sellerBadge tier）。
  // 用已算好的 collectCountMap 就地累加，零额外查询；无作者/无数据回落 tier 1。
  const sellerCollectTotal = new Map<string, number>();
  for (const c of courses) {
    if (!c.authorUserId) continue;
    const cc = collectCountMap.get(c.id) ?? 0;
    sellerCollectTotal.set(c.authorUserId, (sellerCollectTotal.get(c.authorUserId) ?? 0) + cc);
  }

  // ——— 组装摊位视图模型 ———
  return courses.map((c) => {
    const collectCount = collectCountMap.get(c.id) ?? 0;
    const seller = c.authorUserId ? authorMap.get(c.authorUserId) : undefined;
    const sellerLevel = c.authorUserId
      ? sellerBadge(sellerCollectTotal.get(c.authorUserId) ?? 0).tier
      : 1;
    // 评分：有真实评价读真实聚合；否则回退占位派生（isPlaceholder=true，卡片标「示例」）。
    const real = realRatingMap.get(c.id);
    const ph = real ? null : deriveCourseRating(c.id, c.learnersCount);
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle ?? c.description ?? null,
      category: c.category,
      coverColor: c.coverColor,
      coverSrc: marketStallCoverSrc(c.slug, c.category ?? ""),
      origin: c.origin,
      collectCount,
      learnersCount: c.learnersCount,
      priceCredits: c.priceCredits,
      isPaid: (c.priceCredits ?? 0) > 0,
      salesCount: c.salesCount,
      collectedByMe: myCollectedSet.has(c.id),
      mine: Boolean(viewerId && c.authorUserId === viewerId),
      createdAtMs: c.createdAt.getTime(),
      ratingScore: real ? real.score : ph!.score,
      ratingCount: real ? real.count : ph!.count,
      ratingIsPlaceholder: !real,
      seller: {
        id: c.authorUserId,
        nickname: seller?.nickname ?? "匿名同学",
        avatarUrl: seller?.avatarUrl ?? null,
        level: sellerLevel,
      },
    };
  });
}

/** 商品详情页大纲预览的单节形状（只出展示所需字段，不泄露正文/直链）。 */
export interface StallLessonPreview {
  id: string;
  title: string;
  summary: string | null;
  durationSec: number;
  isFree: boolean;
  sortOrder: number;
}

/** 摊主「店铺」聚合信号（商品页塑造「店主」代入感：在架几门、累计成交、店龄）。 */
export interface StallSellerShop {
  /** 该摊主在集市在架（shared）的课数。 */
  stallCount: number;
  /** 该摊主全部在架课的累计被拿走数（去重学习者，排除作者本人）。 */
  totalCollects: number;
  /** 该摊主全部在架课的累计付费成交数（salesCount 之和）。 */
  totalSales: number;
  /** 摊主等级（sellerBadge tier，按 totalCollects 派生，与卡片口径一致）。 */
  level: number;
}

/** 商品详情视图模型：摊位本体 + 大纲预览 + 店铺信号 + 占位评分。 */
export interface StallDetail {
  stall: MarketStall;
  lessons: StallLessonPreview[];
  shop: StallSellerShop;
  /** 评分聚合（S5）：有真实评价读真实均分/条数/分布；零评价回退占位派生（isPlaceholder=true）。 */
  rating: CourseRatingAggregate;
  /** 课程简介（description 优先，subtitle 兜底），商品页正文展示。 */
  description: string | null;
}

/**
 * 商品详情页数据（server-only）：按 slug 取一门在架课，组装成「商品」视图。
 *
 * 与集市列表共用 buildMarketStalls 的语义（拿走数排除作者本人、collectedByMe/mine
 * 严格 where userId），此处只额外补：大纲预览（章节标题/时长/是否免费）、
 * 摊主店铺聚合（在架几门/累计成交）、占位评分。
 *
 * 可见性铁律：只暴露 sharedStatus="shared" 的课（在集市在售的才算「商品」）；
 *   非在架课返回 null（页面 notFound），杜绝拿未上架课的商品页当泄露入口。
 *
 * @param slug 课程 slug。
 * @param viewerId 当前登录用户 id；游客传 null（collectedByMe/mine 恒 false）。
 * @returns 商品详情视图模型；课不存在 / 未在架 → null。
 */
export async function buildStallDetail(
  slug: string,
  viewerId: string | null,
): Promise<StallDetail | null> {
  const course = await prisma.course.findFirst({
    where: { slug, sharedStatus: "shared" },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      category: true,
      coverColor: true,
      origin: true,
      authorUserId: true,
      learnersCount: true,
      priceCredits: true,
      salesCount: true,
      createdAt: true,
      lessons: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, summary: true, durationSec: true, isFree: true, sortOrder: true },
      },
    },
  });
  if (!course) return null;

  // 本课拿走数（去重学习者，排除作者本人）——与列表口径一致。
  const collectRows = await prisma.learningProgress.groupBy({
    by: ["userId"],
    where: { courseId: course.id },
  });
  const collectCount = collectRows.filter((r) => r.userId !== course.authorUserId).length;

  // 当前用户是否已拥有本课（所有权真值源 CoursePurchase；越权铁律：where userId=我）。
  // 决定商品页 CTA（已在书架/去学习 vs 购买按钮）；免费预览进度不再算「已拥有」。
  let collectedByMe = false;
  if (viewerId) {
    const mine = await prisma.coursePurchase.findUnique({
      where: { userId_courseId: { userId: viewerId, courseId: course.id } },
      select: { id: true },
    });
    collectedByMe = Boolean(mine);
  }

  // 摊主信息 + 店铺聚合（该作者全部在架课的成交/拿走）。
  const author = course.authorUserId
    ? await prisma.user.findUnique({
        where: { id: course.authorUserId },
        select: { id: true, nickname: true, avatarUrl: true },
      })
    : null;

  let shop: StallSellerShop = { stallCount: 0, totalCollects: 0, totalSales: 0, level: 1 };
  if (course.authorUserId) {
    const sellerCourses = await prisma.course.findMany({
      where: { authorUserId: course.authorUserId, sharedStatus: "shared" },
      select: { id: true, salesCount: true },
    });
    const sellerIds = sellerCourses.map((c) => c.id);
    // 该摊主全部在架课的去重学习者（排除摊主本人），逐课累加为店铺总拿走。
    const rows =
      sellerIds.length > 0
        ? await prisma.learningProgress.groupBy({
            by: ["courseId", "userId"],
            where: { courseId: { in: sellerIds } },
          })
        : [];
    let totalCollects = 0;
    for (const r of rows) {
      if (r.userId === course.authorUserId) continue;
      totalCollects += 1;
    }
    const totalSales = sellerCourses.reduce((s, c) => s + c.salesCount, 0);
    shop = {
      stallCount: sellerCourses.length,
      totalCollects,
      totalSales,
      level: sellerBadge(totalCollects).tier,
    };
  }

  // 评分聚合（S5）：算一次，同时喂给 stall 的 rating* 字段与返回的 rating（详情页头区展示）。
  const rating = await getCourseRatingAggregate(course.id, course.learnersCount);

  const stall: MarketStall = {
    id: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle ?? course.description ?? null,
    category: course.category,
    coverColor: course.coverColor,
    coverSrc: marketStallCoverSrc(course.slug, course.category ?? ""),
    origin: course.origin,
    collectCount,
    learnersCount: course.learnersCount,
    priceCredits: course.priceCredits,
    isPaid: (course.priceCredits ?? 0) > 0,
    salesCount: course.salesCount,
    collectedByMe,
    mine: Boolean(viewerId && course.authorUserId === viewerId),
    createdAtMs: course.createdAt.getTime(),
    ratingScore: rating.score,
    ratingCount: rating.count,
    ratingIsPlaceholder: rating.isPlaceholder,
    seller: {
      id: course.authorUserId,
      nickname: author?.nickname ?? "匿名同学",
      avatarUrl: author?.avatarUrl ?? null,
      level: shop.level,
    },
  };

  return {
    stall,
    lessons: course.lessons,
    shop,
    rating,
    description: course.description ?? course.subtitle ?? null,
  };
}
