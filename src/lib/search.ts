import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import { buildExcerpt } from "./format";

/**
 * 五域联搜（流2 · U2 搜索与发现）。
 *
 * 域：courses / notes / posts / market / demands。每域用 SQLite `contains`（大小写不敏感，
 * SQLite 默认 NOCASE 对 ASCII 生效；中文按字节匹配足够）在该域的关键字段上召回，带 type 标记、
 * 每域限量，统一映射为 {type,id,title,snippet,href,...} 卡片。
 *
 * 越权铁律（与各域现有 route / queries 保持完全一致，不放宽一分）：
 * - notes：严格 `where userId=当前用户` + `deletedAt=null`；未登录（viewerId 为空）直接返空数组，不查库。
 * - courses：仅「公开可读」——published 且（官方 official / 已分享集市 shared / 本人造课 / 已购买）。
 *   他人的私有 AI 课/导入课不得被搜到（对齐 canViewCourse + hasPurchasedCourse 买断放行）。
 * - posts：仅 status=approved（审核通过的公开帖）。
 * - market：仅 sharedStatus=shared（在架摊位）。
 * - demands：公开需求广场，全部可搜（与 /demands 列表口径一致）。
 *
 * href 规则（均指向真实存在的详情页/落点，先行确认路由）：
 * - course  → /courses/[slug]（详情页以 id|slug 解析，用 slug 更稳）
 * - note    → /notes/[id]
 * - post    → /u/[authorId]（帖子无独立详情页，落到作者主页帖子流——唯一可深链的真实落点）
 * - market  → /market/[slug]
 * - demand  → /demands/[id]（路由段名 demandId，值即需求 id）
 */

export type SearchDomain = "course" | "note" | "post" | "market" | "demand";

export interface SearchResult {
  type: SearchDomain;
  id: string;
  title: string;
  snippet: string;
  href: string;
  /** 域内附加元信息（如课程赛道、帖子类型），供前端做次级标签展示，可选。 */
  meta?: Record<string, string | number | boolean | null>;
}

export interface SearchResponse {
  results: SearchResult[];
  counts: Record<SearchDomain, number>;
}

/** 每域默认返回上限（联搜求「广度优先」，各域少量高相关即可，避免单域刷屏）。 */
const PER_DOMAIN_DEFAULT = 5;
const PER_DOMAIN_MAX = 10;

/** 帖子类型 → 中文标签（与 posts 域一致的三类）。 */
const POST_TYPE_LABEL: Record<string, string> = {
  insight: "学习心得",
  checkin: "打卡",
  question: "求助",
};

/**
 * 五域联搜主入口。
 * @param q        原始查询串（调用方已 trim；空串在 route 层短路，不应到这里）
 * @param viewerId 当前登录用户 id；未登录传 null（notes 域据此返空）
 * @param perDomain 每域上限（钳制到 [1, PER_DOMAIN_MAX]）
 */
export async function searchAll(
  q: string,
  viewerId: string | null,
  perDomain = PER_DOMAIN_DEFAULT,
): Promise<SearchResponse> {
  const term = q.trim();
  const take = Math.min(Math.max(1, perDomain), PER_DOMAIN_MAX);

  // 空查询：不查库，返回全零（route 层通常已短路，这里兜底保证纯函数语义）。
  if (!term) {
    return {
      results: [],
      counts: { course: 0, note: 0, post: 0, market: 0, demand: 0 },
    };
  }

  const [courses, notes, posts, market, demands] = await Promise.all([
    searchCourses(term, viewerId, take),
    searchNotes(term, viewerId, take),
    searchPosts(term, take),
    searchMarket(term, take),
    searchDemands(term, take),
  ]);

  const results = [...courses, ...notes, ...posts, ...market, ...demands];
  return {
    results,
    counts: {
      course: courses.length,
      note: notes.length,
      post: posts.length,
      market: market.length,
      demand: demands.length,
    },
  };
}

/**
 * courses 域：published 且「可见给当前访问者」。
 * 可见性 = 官方课 OR 已分享集市 OR 本人造课 OR 已购买（买断放行）。
 * 未登录时 authorUserId=我 与「已购」两支恒空，只剩官方/shared——与 canViewCourse 游客口径一致。
 */
async function searchCourses(term: string, viewerId: string | null, take: number): Promise<SearchResult[]> {
  // 已购课 id 集合（买断放行）：严格 where userId=我；未登录跳过（不查库）。
  const purchasedIds = viewerId
    ? (
        await prisma.coursePurchase.findMany({
          where: { userId: viewerId },
          select: { courseId: true },
        })
      ).map((p) => p.courseId)
    : [];

  // 可见性 OR：官方 / 已分享集市 / 本人造课 / 已购买。
  const visibility: Prisma.CourseWhereInput[] = [
    { origin: "official" },
    { sharedStatus: "shared" },
  ];
  if (viewerId) visibility.push({ authorUserId: viewerId });
  if (purchasedIds.length) visibility.push({ id: { in: purchasedIds } });

  const rows = await prisma.course.findMany({
    where: {
      status: "published",
      AND: [
        { OR: visibility },
        {
          OR: [
            { title: { contains: term } },
            { subtitle: { contains: term } },
            { description: { contains: term } },
          ],
        },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      category: true,
    },
    orderBy: [{ isFeatured: "desc" }, { learnersCount: "desc" }],
    take,
  });

  return rows.map((c) => ({
    type: "course" as const,
    id: c.id,
    title: c.title,
    snippet: buildExcerpt(c.subtitle || c.description || "", 100),
    href: `/courses/${c.slug}`,
    meta: { category: c.category },
  }));
}

/**
 * notes 域：越权铁律——严格 where userId=当前用户 + 未软删。未登录直接返空（不查库）。
 * 搜 title / contentMd / excerpt。
 */
async function searchNotes(term: string, viewerId: string | null, take: number): Promise<SearchResult[]> {
  if (!viewerId) return [];

  const rows = await prisma.note.findMany({
    where: {
      userId: viewerId,
      deletedAt: null,
      OR: [
        { title: { contains: term } },
        { contentMd: { contains: term } },
        { excerpt: { contains: term } },
      ],
    },
    select: { id: true, title: true, excerpt: true, contentMd: true },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take,
  });

  return rows.map((n) => ({
    type: "note" as const,
    id: n.id,
    title: n.title?.trim() || buildExcerpt(n.contentMd, 24) || "无标题笔记",
    snippet: n.excerpt?.trim() || buildExcerpt(n.contentMd, 100),
    href: `/notes/${n.id}`,
  }));
}

/**
 * posts 域：仅审核通过（status=approved）的公开帖。搜 content。
 * href 落作者主页帖子流（帖子无独立详情页）。
 */
async function searchPosts(term: string, take: number): Promise<SearchResult[]> {
  const rows = await prisma.post.findMany({
    where: {
      status: "approved",
      content: { contains: term },
    },
    select: {
      id: true,
      content: true,
      type: true,
      userId: true,
      user: { select: { nickname: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return rows.map((p) => ({
    type: "post" as const,
    id: p.id,
    title: buildExcerpt(p.content, 40) || "帖子",
    snippet: buildExcerpt(p.content, 100),
    href: `/u/${p.userId}`,
    meta: { postType: POST_TYPE_LABEL[p.type] ?? p.type, author: p.user?.nickname ?? null },
  }));
}

/**
 * market 域：仅在架摊位（sharedStatus=shared）。搜底层 course 的 title/subtitle/description。
 * 与 courses 域可能有重叠（shared 课两域都出），但语义不同（集市摊位 vs 课程详情），各自成组。
 */
async function searchMarket(term: string, take: number): Promise<SearchResult[]> {
  const rows = await prisma.course.findMany({
    where: {
      sharedStatus: "shared",
      OR: [
        { title: { contains: term } },
        { subtitle: { contains: term } },
        { description: { contains: term } },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      priceCredits: true,
    },
    orderBy: [{ salesCount: "desc" }, { lastUpdatedAt: "desc" }],
    take,
  });

  return rows.map((c) => ({
    type: "market" as const,
    id: c.id,
    title: c.title,
    snippet: buildExcerpt(c.subtitle || c.description || "", 100),
    href: `/market/${c.slug}`,
    meta: { priceCredits: c.priceCredits ?? 0, free: (c.priceCredits ?? 0) <= 0 },
  }));
}

/**
 * demands 域：公开需求广场，全部可搜（与 /demands 列表一致）。搜 title/description。
 */
async function searchDemands(term: string, take: number): Promise<SearchResult[]> {
  const rows = await prisma.demand.findMany({
    where: {
      OR: [{ title: { contains: term } }, { description: { contains: term } }],
    },
    select: { id: true, title: true, description: true, category: true, status: true },
    orderBy: { createdAt: "desc" },
    take,
  });

  return rows.map((d) => ({
    type: "demand" as const,
    id: d.id,
    title: d.title,
    snippet: buildExcerpt(d.description || "", 100),
    href: `/demands/${d.id}`,
    meta: { category: d.category, status: d.status },
  }));
}
