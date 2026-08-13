import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assessCoursePresentation,
  courseGenerationInputFingerprint,
  courseGenerationQualityState,
  coverageVerdictPassesPolicy,
  summarizeCourseGenerationReadiness,
} from "./course-gen";
import type { MarketPublicationFence } from "./credit-trade";
import { assessmentNeedForLesson, readCourseContentBrief } from "./ai/content-brief";

export type { MarketPublicationFence } from "./credit-trade";

/**
 * 集市新展示/新交易的基础真值。已购访问不走此门，由 CoursePurchase 独立保障。
 * user_created 没有 AI 生成终审档案，仍以人工审核后的 shared 为发布真值。
 */
export const MARKET_BASE_WHERE = {
  status: "published",
  sharedStatus: "shared",
  OR: [
    { origin: { in: ["user_created", "ai_generated", "user_imported"] }, genStatus: "ready" },
  ],
} satisfies Prisma.CourseWhereInput;

export function marketBaseWhere(extra: Prisma.CourseWhereInput = {}): Prisma.CourseWhereInput {
  if (Object.keys(extra).length === 0) return MARKET_BASE_WHERE;
  // extra 常自带 OR（搜索词、slug|id）；不得用展开合并让发布门的 OR 覆盖它。
  return { AND: [extra, MARKET_BASE_WHERE] };
}

/**
 * 对基础 SQL 门后的少量候选做当前发布档案/表现层校验。
 * assessCourseGenerationPublication 是只读、零 LLM；列表调用方并发执行，避免串行 N+1 延迟。
 */
export async function currentCoursePublicationFence(course: {
  id: string;
  title: string;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
  contentBriefJson: string | null;
  modelUsed: string | null;
  origin: string;
  genStatus: string | null;
  generationQualityJson: string | null;
  presentationRevision: number;
  lessons: Array<{
    id: string;
    title: string;
    summary: string | null;
    blocksJson: string | null;
    qualityJson: string | null;
    htmlJson: string | null;
    renderSourceHash: string | null;
    renderEngine: string | null;
    designJson: string | null;
  }>;
}, trade?: { priceCredits: number | null; firstLessonId: string; authorUserId: string | null; title: string }): Promise<MarketPublicationFence | null> {
  const tradeFence = trade ?? { priceCredits: null, firstLessonId: "", authorUserId: null, title: "" };
  if (course.origin === "user_created") {
    const presentation = assessCoursePresentation(course);
    const presentationReady = course.genStatus === "ready" && presentation.total > 0 && presentation.ready === presentation.total;
    if (!presentationReady) return null;
    return {
      courseId: course.id,
      origin: course.origin,
      generationQualityJson: null,
      presentationRevision: course.presentationRevision,
      ...tradeFence,
    };
  }
  if ((course.origin !== "ai_generated" && course.origin !== "user_imported") || course.genStatus !== "ready") return null;
  const brief = readCourseContentBrief(course.contentBriefJson);
  const readiness = summarizeCourseGenerationReadiness(course.lessons);
  if (!brief || !readiness.ready) return null;
  const inputFingerprint = courseGenerationInputFingerprint({
    courseTitle: course.title,
    contentBrief: brief,
    model: course.modelUsed,
    lessons: course.lessons.map((lesson, index) => ({
      id: lesson.id,
      title: lesson.title,
      objective: lesson.summary,
      assessmentNeed: assessmentNeedForLesson(brief, { title: lesson.title, index }),
      blocksJson: lesson.blocksJson,
      qualityJson: lesson.qualityJson,
    })),
  });
  const quality = courseGenerationQualityState(course.generationQualityJson, inputFingerprint);
  const coverageReady = quality.state === "passed" && quality.archive?.verdict
    ? coverageVerdictPassesPolicy(quality.archive.verdict, brief, course.lessons.map((lesson) => lesson.id))
    : false;
  const presentation = assessCoursePresentation(course);
  if (!coverageReady || presentation.total === 0 || presentation.ready !== presentation.total) return null;
  return {
    courseId: course.id,
    origin: course.origin,
    generationQualityJson: course.generationQualityJson,
    presentationRevision: course.presentationRevision,
    ...tradeFence,
  };
}

export async function currentMarketPublicationFence(course: {
  id: string;
  title: string;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
  contentBriefJson: string | null;
  modelUsed: string | null;
  status: string;
  sharedStatus: string;
  origin: string;
  genStatus: string | null;
  generationQualityJson: string | null;
  presentationRevision: number;
  lessons: Array<{
    id: string;
    title: string;
    summary: string | null;
    blocksJson: string | null;
    qualityJson: string | null;
    htmlJson: string | null;
    renderSourceHash: string | null;
    renderEngine: string | null;
    designJson: string | null;
  }>;
}, trade?: { priceCredits: number | null; firstLessonId: string; authorUserId: string | null; title: string }): Promise<MarketPublicationFence | null> {
  if (course.status !== "published" || course.sharedStatus !== "shared") return null;
  return currentCoursePublicationFence(course, trade);
}

export async function filterCurrentMarketCourses<T extends {
  id: string;
  title: string;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
  contentBriefJson: string | null;
  modelUsed: string | null;
  status: string;
  sharedStatus: string;
  origin: string;
  genStatus: string | null;
  generationQualityJson: string | null;
  presentationRevision: number;
  lessons: Array<{
    id: string;
    title: string;
    summary: string | null;
    blocksJson: string | null;
    qualityJson: string | null;
    htmlJson: string | null;
    renderSourceHash: string | null;
    renderEngine: string | null;
    designJson: string | null;
  }>;
}>(courses: T[]): Promise<T[]> {
  const fences = await Promise.all(courses.map((course) => currentMarketPublicationFence(course)));
  return courses.filter((_, index) => fences[index] !== null);
}

// ————— 集市热路径的按 revision 缓存过滤 —————
//
// 上面的纯函数每次都要吃进全部课件 blob（blocksJson/htmlJson/…）做指纹与表现层校验，
// 集市列表/详情是 force-dynamic 高频路径，每个请求把 60 门课的全部课件拖出 SQLite
// 再逐课 sha256 是不可接受的。本节提供带进程内缓存的轻量入口：
//
// 契约：presentationRevision 是课程内容/表现层的变更时钟——所有语义写入都经
// claimCourseContentMutation（或同事务的 revision CAS）自增它，genStatus 与
// generationQualityJson 直接进键。因此 (id, revision, genStatus, quality) 相同 ⇒
// 围栏结论相同，可直接复用；只有 miss 的课才补拉课件 blob 计算一次。
// 需要逐字段纯语义（测试、审核单课）请继续用上面的纯函数。

/** 轻量候选：不含 lessons，全部为课行标量字段。 */
export interface MarketFenceCourseLight {
  id: string;
  title: string;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
  contentBriefJson: string | null;
  modelUsed: string | null;
  status: string;
  sharedStatus: string;
  origin: string;
  genStatus: string | null;
  generationQualityJson: string | null;
  presentationRevision: number;
}

const FENCE_CACHE_MAX = 1000;
const fenceCache = new Map<string, { key: string; eligible: boolean }>();

function fenceCacheKey(c: MarketFenceCourseLight): string {
  return `${c.presentationRevision}:${c.genStatus ?? ""}:${c.origin}:${c.generationQualityJson ?? ""}`;
}

/** 测试隔离用：清空围栏缓存。 */
export function clearMarketFenceCache(): void {
  fenceCache.clear();
}

/**
 * 按 revision 缓存过滤在架课（集市列表/详情/店铺热路径专用）。
 * 候选只需课行标量；仅缓存 miss 的课会补拉课件 blob 计算真实围栏。
 */
export async function filterCurrentMarketCoursesByRevision<T extends MarketFenceCourseLight>(
  candidates: T[],
  db: Pick<typeof prisma, "lesson"> = prisma,
): Promise<T[]> {
  const misses = candidates.filter((c) => {
    const cached = fenceCache.get(c.id);
    return !cached || cached.key !== fenceCacheKey(c);
  });
  const blobsByCourse = new Map<string, Array<{
    id: string; title: string; summary: string | null; blocksJson: string | null;
    qualityJson: string | null; htmlJson: string | null; renderSourceHash: string | null;
    renderEngine: string | null; designJson: string | null;
  }>>();
  if (misses.length > 0) {
    const lessons = await db.lesson.findMany({
      where: { courseId: { in: misses.map((c) => c.id) } },
      select: {
        courseId: true, id: true, title: true, summary: true, blocksJson: true,
        qualityJson: true, htmlJson: true, renderSourceHash: true, renderEngine: true, designJson: true,
      },
    });
    for (const { courseId, ...lesson } of lessons) {
      const list = blobsByCourse.get(courseId);
      if (list) list.push(lesson);
      else blobsByCourse.set(courseId, [lesson]);
    }
  }
  const result: T[] = [];
  for (const candidate of candidates) {
    const key = fenceCacheKey(candidate);
    const cached = fenceCache.get(candidate.id);
    let eligible: boolean;
    if (cached && cached.key === key) {
      // 缓存只记内容围栏结论；上架门（status/sharedStatus）是行内标量，命中时照常再验。
      eligible = cached.eligible && candidate.status === "published" && candidate.sharedStatus === "shared";
    } else {
      const fence = await currentMarketPublicationFence({
        ...candidate,
        lessons: blobsByCourse.get(candidate.id) ?? [],
      });
      eligible = fence !== null;
      if (fenceCache.size >= FENCE_CACHE_MAX && !fenceCache.has(candidate.id)) {
        const oldest = fenceCache.keys().next().value;
        if (oldest !== undefined) fenceCache.delete(oldest);
      }
      fenceCache.set(candidate.id, { key, eligible });
    }
    if (eligible) result.push(candidate);
  }
  return result;
}
