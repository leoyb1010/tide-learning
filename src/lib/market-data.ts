/**
 * 集市数据层（server-only）：把「查已上架课 + 聚合拿走数 + 我拿走过哪些 + 摊主信息」
 * 组装成 MarketStall[] 的**唯一一份**逻辑。Web server page（/market）与
 * iOS API（GET /api/market）都调本函数，保证字段与语义完全一致。
 *
 * 铁律：
 *   - 拿走数（collectCount）= 有该课学习记录的去重用户数，**排除作者本人**
 *     （与 collect 端点禁自收藏一致，与 Web 集市页上轮修的逻辑一致）。
 *   - 「我拿走过哪些」严格 where userId=当前用户（越权铁律）；游客传 null 时跳过。
 */

import { prisma } from "@/lib/db";
import { marketStallCoverSrc } from "@/lib/tracks";
import { sellerBadge, type MarketStall } from "@/lib/market-view";

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

  // 我拿走过哪些课（越权铁律：where userId=我）——决定 CTA 初始态。游客跳过。
  const myCollectedSet = new Set<string>();
  if (viewerId && courseIds.length > 0) {
    const mine = await prisma.learningProgress.groupBy({
      by: ["courseId"],
      where: { userId: viewerId, courseId: { in: courseIds } },
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
      collectedByMe: myCollectedSet.has(c.id),
      mine: Boolean(viewerId && c.authorUserId === viewerId),
      createdAtMs: c.createdAt.getTime(),
      seller: {
        id: c.authorUserId,
        nickname: seller?.nickname ?? "匿名同学",
        avatarUrl: seller?.avatarUrl ?? null,
        level: sellerLevel,
      },
    };
  });
}
