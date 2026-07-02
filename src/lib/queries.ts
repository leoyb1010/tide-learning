import { prisma } from "./db";
import { resolveEntitlement, canAccessLesson, type EntitlementSnapshot } from "./entitlement";
import { rankDemands } from "./demand-score";
import { TRACK_MAP, trackLabel } from "./tracks";

// 赛道标签（融合有道内容板块）。保留 CATEGORY_LABELS 名以兼容旧引用。
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TRACK_MAP).map(([k, t]) => [k, t.label]),
);
export const LEVEL_LABELS: Record<string, string> = { L1: "L1 入门", L2: "L2 进阶", L3: "L3 高阶" };

export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const day = Math.floor(diff / 864e5);
  if (day <= 0) return "今天";
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  if (day < 365) return `${Math.floor(day / 30)} 个月前`;
  return `${Math.floor(day / 365)} 年前`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

/** 课程卡数据（§6.2 字段）。 */
export async function listCourses(opts?: { category?: string; sort?: string; q?: string }) {
  const courses = await prisma.course.findMany({
    where: {
      status: "published",
      ...(opts?.category && opts.category !== "all" ? { category: opts.category } : {}),
      ...(opts?.q
        ? { OR: [{ title: { contains: opts.q } }, { subtitle: { contains: opts.q } }] }
        : {}),
    },
    include: {
      _count: { select: { lessons: true } },
      lessons: { where: { isFree: true }, select: { id: true } },
      updateLogs: { orderBy: { publishedAt: "desc" }, take: 1 },
    },
  });

  const mapped = courses.map((c) => ({
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
  }));

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
    include: {
      lessons: { orderBy: { sortOrder: "asc" } },
      updateLogs: { orderBy: { publishedAt: "desc" } },
    },
  });
  if (!course) return null;
  const snapshot = await resolveEntitlement(userId);

  return {
    course,
    snapshot,
    categoryLabel: CATEGORY_LABELS[course.category],
    levelLabel: LEVEL_LABELS[course.level],
    durationText: formatDuration(course.totalDurationSec),
    lessons: course.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      contentType: l.contentType,
      durationSec: l.durationSec,
      isFree: l.isFree,
      canAccess: canAccessLesson(course.category, l.isFree, snapshot),
    })),
    updateLogs: course.updateLogs.map((u) => ({
      ...u,
      relativeTime: relativeTime(u.publishedAt),
    })),
  };
}

/** 单章节，附带服务端访问判断——非订阅用户拿不到付费视频直链（§6.4 验收）。 */
export async function getLessonForUser(lessonId: string, userId: string | null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: { include: { lessons: { orderBy: { sortOrder: "asc" } } } },
      subtitles: { orderBy: { startSec: "asc" } },
    },
  });
  if (!lesson) return null;
  const snapshot = await resolveEntitlement(userId);
  const access = canAccessLesson(lesson.course.category, lesson.isFree, snapshot);

  const siblings = lesson.course.lessons;
  const idx = siblings.findIndex((l) => l.id === lesson.id);

  return {
    snapshot,
    access,
    course: lesson.course,
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
      // 关键：付费章节且无权益时，videoUrl / articleMd 一律为 null
      videoUrl: access && lesson.videoAssetId ? signedVideoUrl(lesson.videoAssetId) : null,
      articleMd: access ? lesson.articleMd : null,
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
  return `/api/stream/${assetId}?exp=${exp}`;
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
export async function listRankedDemands(statuses?: string[]) {
  const ranked = await rankDemands(statuses);
  return ranked.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    categoryLabel: CATEGORY_LABELS[d.category] ?? d.category,
    status: d.status,
    totalVotes: d.totalVotes,
    officialReply: d.officialReply,
    launchedCourseId: d.launchedCourseId,
  }));
}

export type { EntitlementSnapshot };
