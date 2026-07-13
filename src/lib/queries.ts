import { prisma } from "./db";
import { createStreamSignature } from "./private-media";
import { resolveEntitlement, canAccessLesson, type EntitlementSnapshot } from "./entitlement";
import { rankDemands } from "./demand-score";
import { TRACK_MAP, trackLabel } from "./tracks";
import { deriveCourseRating } from "./course-rating";
import { batchCourseRealRatings } from "./course-review";
// 创作者中心（U4-a）复用集市交易层已算好的按课收益聚合（越权铁律 where userId=作者）。
import { getAuthorEarnings } from "./credit-trade";
import { LEDGER_TYPE } from "./credit-trade";
// relativeTime / formatDuration 是零依赖纯日期函数，已迁至 @/lib/format（无 "use client"、
// 不 import prisma）。此处 re-export 以兼容既有 server 侧引用（desk/me/demands 等）。
import { relativeTime, formatDuration } from "./format";
import { COURSE_PUBLIC_SELECT, LESSON_OUTLINE_SELECT } from "./course-public-select";

// 赛道标签（融合有道内容板块）。保留 CATEGORY_LABELS 名以兼容旧引用。
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TRACK_MAP).map(([k, t]) => [k, t.label]),
);
export const LEVEL_LABELS: Record<string, string> = { L1: "L1 入门", L2: "L2 进阶", L3: "L3 高阶" };

// 兼容既有 server 侧 `import { relativeTime, formatDuration } from "@/lib/queries"`。
export { relativeTime, formatDuration };

/**
 * 归属/可见性门（与订阅门 canAccessLesson 叠加，各管一件事）：
 * 判定「这门课该不该对当前访问者存在」。挡的是他人的私有课（AI 造课/导入课越权读取）。
 * - 官方课（origin === "official"）：始终公开可读。
 * - 非官方课：仅当「作者本人访问」或「已分享到集市（sharedStatus === "shared"）」才可读。
 *   游客（viewerUserId 为空）看不到任何非官方私有课，只能读 shared 或官方课。
 * 不满足即视为不存在（调用方 return null → 页面 notFound / API 404）。
 */
export function canViewCourse(
  course: { origin: string; authorUserId: string | null; sharedStatus: string },
  viewerUserId: string | null,
): boolean {
  if (course.origin === "official") return true;
  if (course.sharedStatus === "shared") return true;
  return !!viewerUserId && course.authorUserId === viewerUserId;
}

/**
 * 是否已购买本课（CoursePurchase 所有权真值源）——买断放行的判据。
 * 越权铁律：严格 where userId=我。游客（userId 为空）恒 false，不查库。
 */
export async function hasPurchasedCourse(courseId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const row = await prisma.coursePurchase.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  return Boolean(row);
}

/** 课程卡数据（§6.2 字段）。 */
export async function listCourses(opts?: { category?: string; sort?: string; q?: string | string[] }) {
  // q 支持单串或多关键词（语义搜索场景4：LLM 扩展的同义词组）——任一词命中 title/subtitle 即召回
  const terms = Array.isArray(opts?.q) ? opts.q.filter(Boolean) : opts?.q ? [opts.q] : [];
  const courses = await prisma.course.findMany({
    where: {
      status: "published",
      // 课程库污染修复：AI 造的私有课(status=published+visibility=private)不得进公共课程库。
      // 官方 seed 课默认 visibility="public"（schema 默认，seed 未显式覆盖），只挡住私有 AI 课。
      visibility: "public",
      ...(opts?.category && opts.category !== "all" ? { category: opts.category } : {}),
      ...(terms.length
        ? { OR: terms.flatMap((t) => [{ title: { contains: t } }, { subtitle: { contains: t } }]) }
        : {}),
    },
    include: {
      _count: { select: { lessons: true } },
      lessons: { where: { isFree: true }, select: { id: true } },
      updateLogs: { orderBy: { publishedAt: "desc" }, take: 1 },
    },
  });

  // 真实评分批量聚合（S5）：一次 groupBy 取所有课的真实均分/条数，无评价的课回退占位派生。
  const realRatingMap = await batchCourseRealRatings(courses.map((c) => c.id));

  const mapped = courses.map((c) => {
    const real = realRatingMap.get(c.id);
    const ph = real ? null : deriveCourseRating(c.id, c.learnersCount);
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      category: c.category,
      categoryLabel: CATEGORY_LABELS[c.category],
      level: c.level,
      levelLabel: LEVEL_LABELS[c.level],
      coverColor: c.coverColor,
      status: c.status,
      updateText: c.updateLogs[0]
        ? `${c.updateLogs[0].title} · ${relativeTime(c.updateLogs[0].publishedAt)}`
        : `${c.updateCadence ?? "持续更新"}`,
      updateCadence: c.updateCadence,
      duration: formatDuration(c.totalDurationSec),
      lessonsCount: c._count.lessons,
      learnersCount: c.learnersCount,
      freeLessonsCount: c.lessons.length,
      isFeatured: c.isFeatured,
      lastUpdatedAt: c.lastUpdatedAt,
      // 评分（S5）：有真实评价读真实、零评价占位派生；卡片据 ratingIsPlaceholder 标「示例」。
      ratingScore: real ? real.score : ph!.score,
      ratingCount: real ? real.count : ph!.count,
      ratingIsPlaceholder: !real,
    };
  });

  switch (opts?.sort) {
    case "newest":
      mapped.sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());
      break;
    case "learners":
      mapped.sort((a, b) => b.learnersCount - a.learnersCount);
      break;
    case "beginner":
      mapped.sort((a, b) => a.level.localeCompare(b.level));
      break;
    default: // 推荐：精选优先，再按学习人数
      mapped.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || b.learnersCount - a.learnersCount);
  }
  return mapped;
}

/** 课程详情，含大纲与是否可访问标记（服务端权益）。 */
export async function getCourseDetail(idOrSlug: string, userId: string | null) {
  const course = await prisma.course.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      ...COURSE_PUBLIC_SELECT,
      lessons: { orderBy: { sortOrder: "asc" }, select: LESSON_OUTLINE_SELECT },
      updateLogs: {
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          courseId: true,
          lessonId: true,
          updateType: true,
          title: true,
          description: true,
          ownerId: true,
          publishedAt: true,
        },
      },
    },
  });
  if (!course) return null;
  // 归属/可见性门：他人的私有课对当前访问者视为不存在（越权读取修复）。
  if (!canViewCourse(course, userId)) return null;
  const snapshot = await resolveEntitlement(userId);
  // 买断真值源：已购本课（CoursePurchase）则全部章节放行（不走赛道订阅门）。越权铁律：where userId=我。
  const owned = await hasPurchasedCourse(course.id, userId);
  const progress = userId
    ? await prisma.learningProgress.findMany({
        where: { userId, courseId: course.id },
        select: {
          lessonId: true,
          progressSec: true,
          lastSlideIndex: true,
          completedAt: true,
          lastPlayedAt: true,
        },
        orderBy: { lastPlayedAt: "desc" },
      })
    : [];

  const { lessons, updateLogs, ...courseMeta } = course;
  return {
    course: courseMeta,
    snapshot,
    owned,
    progress,
    categoryLabel: CATEGORY_LABELS[course.category],
    levelLabel: LEVEL_LABELS[course.level],
    durationText: formatDuration(course.totalDurationSec),
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      contentType: l.contentType,
      durationSec: l.durationSec,
      isFree: l.isFree,
      canAccess: canAccessLesson(course.category, l.isFree, snapshot, owned),
    })),
    updateLogs: updateLogs.map((u) => ({
      ...u,
      relativeTime: relativeTime(u.publishedAt),
    })),
  };
}

/** 单章节，附带服务端访问判断——非订阅用户拿不到付费视频直链（§6.4 验收）。 */
export async function getLessonForUser(lessonId: string, userId: string | null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      summary: true,
      contentType: true,
      videoAssetId: true,
      videoUrl: true,
      articleMd: true,
      blocksJson: true,
      htmlJson: true,
      videoGenStatus: true,
      videoDurationSec: true,
      durationSec: true,
      isFree: true,
      liveStartAt: true,
      liveSeatLimit: true,
      course: {
        select: {
          ...COURSE_PUBLIC_SELECT,
          lessons: { orderBy: { sortOrder: "asc" }, select: LESSON_OUTLINE_SELECT },
        },
      },
      subtitles: {
        orderBy: { startSec: "asc" },
        select: { startSec: true, endSec: true, text: true },
      },
    },
  });
  if (!lesson) return null;
  // 归属/可见性门：他人的私有课的章节对当前访问者视为不存在（越权读取修复）。
  if (!canViewCourse(lesson.course, userId)) return null;
  const snapshot = await resolveEntitlement(userId);
  // 买断真值源：已购本课（CoursePurchase）则本节放行（不走赛道订阅门，修 P0 买断失能）。越权铁律：where userId=我。
  const owned = await hasPurchasedCourse(lesson.course.id, userId);
  const access = canAccessLesson(lesson.course.category, lesson.isFree, snapshot, owned);

  const { lessons: siblings, ...courseMeta } = lesson.course;
  const idx = siblings.findIndex((l) => l.id === lesson.id);

  return {
    snapshot,
    access,
    course: courseMeta,
    track: lesson.course.category,
    lesson: {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      contentType: lesson.contentType,
      durationSec: lesson.durationSec,
      isFree: lesson.isFree,
      liveStartAt: lesson.liveStartAt ? lesson.liveStartAt.toISOString() : null,
      liveSeatLimit: lesson.liveSeatLimit,
      // 关键：付费章节且无权益时，videoUrl / articleMd / blocksJson 一律为 null。
      // 受控 asset 永远优先经过鉴权流接口；公开直链只允许免费章节使用。
      // 付费章节即使历史数据遗留 videoUrl 也不返回，防止猜测 public 路径绕过权益门。
      videoUrl: access
        ? (lesson.videoAssetId ? signedVideoUrl(lesson.videoAssetId) : lesson.isFree ? lesson.videoUrl : null)
        : null,
      articleMd: access ? lesson.articleMd : null,
      // ai_block 类型的结构化课件（付费门控同 articleMd）
      blocksJson: access ? lesson.blocksJson : null,
      // v3.3 ai_html 类型的自包含 HTML 课件渲染契约（付费门控同 blocksJson；blocksJson 仍保留作兜底/搜索）
      htmlJson: access ? lesson.htmlJson : null,
      // v3.1 视频课件生成态：ready + videoAssetId 时学习页出现「视频」Tab，可播放（复用受控流）。
      // 生成中/pending 显示占位；null 表示未生成视频课件。门控随 access（未订阅付费节拿不到）。
      videoGenStatus: access ? lesson.videoGenStatus : null,
      // 视频课件时长（秒）：只驱动「视频」Tab 的时间轴，与图文阅读语义的 durationSec 隔离。
      videoDurationSec: access ? lesson.videoDurationSec : null,
      subtitles: access ? lesson.subtitles.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text })) : [],
    },
    outline: siblings.map((l) => ({
      id: l.id,
      title: l.title,
      isFree: l.isFree,
      durationSec: l.durationSec,
      current: l.id === lesson.id,
    })),
    prevLessonId: idx > 0 ? siblings[idx - 1].id : null,
    nextLessonId: idx < siblings.length - 1 ? siblings[idx + 1].id : null,
  };
}

/**
 * 短时签名视频 URL（§16/§19：短时 URL / 访问控制。MVP 用带过期戳的 mock 直链）。
 * exp 对齐到 10 分钟窗口边界：同一窗口内多次渲染（SSR HTML 与 hydration payload）得到
 * 完全一致的 URL，避免 Date.now() 抖动导致的 hydration mismatch；同时仍保留"短时过期"语义。
 */
const STREAM_TTL_MS = 10 * 60 * 1000;
function signedVideoUrl(assetId: string): string {
  // 取当前所在时间窗口的下一个边界作为过期戳 —— 稳定、可缓存、跨渲染一致。
  const exp = (Math.floor(Date.now() / STREAM_TTL_MS) + 1) * STREAM_TTL_MS;
  const sig = createStreamSignature(assetId, exp);
  return `/api/stream/${encodeURIComponent(assetId)}?exp=${exp}&sig=${sig}`;
}

/** 本周上新（§6.1 上新卡）。 */
export async function listUpdates(limit = 12) {
  const logs = await prisma.courseUpdateLog.findMany({
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { course: true },
  });
  return logs.map((l) => ({
    id: l.id,
    courseId: l.course.id,
    courseSlug: l.course.slug,
    courseTitle: l.course.title,
    coverColor: l.course.coverColor,
    updateType: l.updateType,
    title: l.title,
    description: l.description,
    relativeTime: relativeTime(l.publishedAt),
    duration: formatDuration(l.course.totalDurationSec),
  }));
}

/** 需求广场排序列表（§6.6 综合分）。 */
/** 单条榜单需求的展示形状（含共创投票所需的社交信号）。 */
export interface RankedDemandView {
  id: string;
  title: string;
  description: string | null;
  category: string;
  categoryLabel: string;
  status: string;
  totalVotes: number;
  /** 本周新增票数（↑N 信号） */
  recentVotes: number;
  officialReply: string | null;
  launchedCourseId: string | null;
  /** 讨论（评论）数 */
  commentCount: number;
  /** 关注进度人数 */
  followerCount: number;
  /** 前 5 位支持者头像（按最近投票排序） */
  supporters: { id: string; nickname: string; avatarUrl: string | null }[];
  /** 发起人昵称（用于「发起人一句话理由」署名） */
  authorNickname: string | null;
}

export async function listRankedDemands(statuses?: string[]): Promise<RankedDemandView[]> {
  const ranked = await rankDemands(statuses);
  if (ranked.length === 0) return [];
  const ids = ranked.map((d) => d.id);

  // 并行聚合社交信号：讨论数、关注数、支持者头像（前 5，按最近投票）、发起人昵称。
  // 支持者头像改为「按 demandId 分组的有界取数」：每条需求仅拉最近 5 条投票，
  // 避免旧实现无 take 上限把该批需求的全部投票行拉进内存（票多时内存/传输放大）。
  const [commentGroups, followGroups, supporterRows, authors] = await Promise.all([
    prisma.comment.groupBy({
      by: ["demandId"],
      where: { demandId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.demandFollow.groupBy({
      by: ["demandId"],
      where: { demandId: { in: ids } },
      _count: { _all: true },
    }),
    Promise.all(
      ids.map((demandId) =>
        prisma.demandVote
          .findMany({
            where: { demandId },
            orderBy: { createdAt: "desc" },
            // 有界且去重：按 userId distinct + take 5，同人跨周多行投票只取最近一行，
            // DB 侧即限量 5，避免旧实现无上限把全部投票行拉进内存再在 JS 去重。
            distinct: ["userId"],
            take: 5,
            select: {
              user: { select: { id: true, nickname: true, avatarUrl: true } },
            },
          })
          .then((rows) => ({ demandId, rows })),
      ),
    ),
    prisma.demand.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { nickname: true } } },
    }),
  ]);

  const commentMap = new Map(commentGroups.map((c) => [c.demandId, c._count._all]));
  const followMap = new Map(followGroups.map((f) => [f.demandId, f._count._all]));
  const authorMap = new Map(authors.map((a) => [a.id, a.user?.nickname ?? null]));

  // 每条需求的支持者已在 DB 侧 distinct+take5 限量并按时间倒序，直接映射。
  const supporterMap = new Map<string, RankedDemandView["supporters"]>(
    supporterRows.map(({ demandId, rows }) => [demandId, rows.map((v) => v.user)]),
  );

  return ranked.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    categoryLabel: CATEGORY_LABELS[d.category] ?? d.category,
    status: d.status,
    totalVotes: d.totalVotes,
    recentVotes: d.recentVotes,
    officialReply: d.officialReply,
    launchedCourseId: d.launchedCourseId,
    commentCount: commentMap.get(d.id) ?? 0,
    followerCount: followMap.get(d.id) ?? 0,
    supporters: supporterMap.get(d.id) ?? [],
    authorNickname: authorMap.get(d.id) ?? null,
  }));
}

/** 首页第三幕共创 teaser 的最小字段（与 ActThree 的 DemandTeaser prop 形状一致）。 */
export interface DemandTeaser {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  totalVotes: number;
}

/**
 * 首页轻查询：只取共创榜首一条 teaser + 征集总数。
 *
 * 关键路径瘦身：首页第三幕只用「榜首一条 + 计数」，不需要 listRankedDemands 的
 * 社交信号（讨论数/关注数/前 5 支持者头像/发起人昵称，共 4 个额外并行查询）。
 * 这里复用 rankDemands（仅 2 个 groupBy 聚合）拿到与榜单完全一致的排序，
 * 取第一名映射为最小 teaser 字段，再单独 count。避免首字节被最慢的社交聚合查询阻塞。
 *
 * 排序口径与 /demands、/api/demands 上的 listRankedDemands 完全一致（同一 rankDemands），
 * 因此首页 teaser 展示的「榜首」与需求广场榜首同一条，不产生视觉/数据分叉。
 */
export async function getHomeDemandTeaser(
  statuses?: string[],
): Promise<{ teaser: DemandTeaser | null; count: number }> {
  const ranked = await rankDemands(statuses);
  const count = ranked.length;
  const top = ranked[0];
  const teaser: DemandTeaser | null = top
    ? {
        id: top.id,
        title: top.title,
        description: top.description,
        categoryLabel: CATEGORY_LABELS[top.category] ?? top.category,
        totalVotes: top.totalVotes,
      }
    : null;
  return { teaser, count };
}

export type { EntitlementSnapshot };

/* ============================================================
   创作者中心（流2·U4-a）—— 作者收益 + 销售看板数据（server-only）
   ============================================================ */

/** 创作者中心单课行：收益 + 成交 + 定价 + 真实评分（无真实评价则 rating=null）。 */
export interface CreatorCourseRow {
  id: string;
  slug: string;
  title: string;
  salesCount: number;
  priceCredits: number | null;
  incomeCredits: number;
  /** 真实均分（有真实评价才有值；无评价 null，前端标「暂无评分」，收益看板求实不派生占位）。 */
  rating: number | null;
  reviewCount: number;
}

/** 创作者中心近期成交流水行：付费售出 + 免费拿走激励皆在此（refId=courseId）。 */
export interface CreatorSaleRow {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  courseSlug: string | null;
  incomeCredits: number;
  reason: string | null;
  createdAt: Date;
}

/** 创作者中心看板：累计收益 + 累计成交 + 每课明细 + 近期成交流水。 */
export interface CreatorDashboard {
  totalIncome: number;
  totalSales: number;
  courses: CreatorCourseRow[];
  recentSales: CreatorSaleRow[];
}

/** 近期成交流水默认取条数（创作者中心只看最近动态；API/页面共用同一口径）。 */
const CREATOR_RECENT_SALES_TAKE = 20;

/**
 * 创作者收益看板（U4-a）—— Web 页（/me/creator）与 API（GET /api/me/creator）共用**唯一一份**
 * 组装逻辑，保证字段与语义完全一致。
 *
 * 复用铁律：累计/按课收益求和复用 credit-trade.ts::getAuthorEarnings（不重写任何交易逻辑，只读复用），
 *   本函数只额外补：真实评分（batchCourseRealRatings，无真实评价则 rating=null）+ 近期成交流水。
 *
 * 越权铁律：getAuthorEarnings 内部 where userId=authorId；近期流水查询亦恒 where userId=authorId，
 *   只返回**该作者本人**数据，调用方传入的必须是当前登录用户 id（在 route/page 侧用 requireUser/session 得出）。
 *
 * @param authorId 作者（= 当前登录用户）userId。
 */
export async function getCreatorDashboard(authorId: string): Promise<CreatorDashboard> {
  // 作者收益概览（复用交易层求和，不另算）。
  const earnings = await getAuthorEarnings(authorId);
  const courseIds = earnings.courses.map((c) => c.courseId);

  // 真实评分批量聚合（无真实评价的课不在 map 中，前端据缺省标「暂无评分」，诚实不冒充）。
  const realRatingMap =
    courseIds.length > 0 ? await batchCourseRealRatings(courseIds) : new Map<string, { score: number; count: number }>();

  // 近期成交流水（越权铁律：where userId=authorId）——付费售出 + 免费拿走激励皆在此。
  const recentRows = await prisma.creditLedger.findMany({
    where: { userId: authorId, type: LEDGER_TYPE.COURSE_SALE_INCOME },
    orderBy: { createdAt: "desc" },
    take: CREATOR_RECENT_SALES_TAKE,
    select: { id: true, delta: true, refId: true, reason: true, createdAt: true },
  });

  // 补课程标题/slug（只查涉及到的课，避免 N+1）。refId=courseId。
  const refCourseIds = Array.from(
    new Set(recentRows.map((r) => r.refId).filter((x): x is string => Boolean(x))),
  );
  const refCourses =
    refCourseIds.length > 0
      ? await prisma.course.findMany({
          where: { id: { in: refCourseIds } },
          select: { id: true, title: true, slug: true },
        })
      : [];
  const refCourseMap = new Map(refCourses.map((c) => [c.id, c]));

  const courses: CreatorCourseRow[] = earnings.courses.map((c) => {
    const rating = realRatingMap.get(c.courseId);
    return {
      id: c.courseId,
      slug: c.slug,
      title: c.title,
      salesCount: c.salesCount,
      priceCredits: c.priceCredits,
      incomeCredits: c.income,
      rating: rating ? rating.score : null,
      reviewCount: rating ? rating.count : 0,
    };
  });

  const recentSales: CreatorSaleRow[] = recentRows.map((r) => {
    const c = r.refId ? refCourseMap.get(r.refId) : undefined;
    return {
      id: r.id,
      courseId: r.refId,
      courseTitle: c?.title ?? null,
      courseSlug: c?.slug ?? null,
      incomeCredits: r.delta,
      reason: r.reason,
      createdAt: r.createdAt,
    };
  });

  return {
    totalIncome: earnings.totalIncome,
    totalSales: earnings.totalSales,
    courses,
    recentSales,
  };
}
