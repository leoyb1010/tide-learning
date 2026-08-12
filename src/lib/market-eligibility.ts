import type { Prisma } from "@prisma/client";
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
