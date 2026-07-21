import type { Prisma } from "@prisma/client";

/** 公开课程元数据。课件正文不得藏在嵌套 Prisma 实体里随响应带出。 */
export const COURSE_PUBLIC_SELECT = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  description: true,
  category: true,
  level: true,
  coverColor: true,
  status: true,
  origin: true,
  visibility: true,
  authorUserId: true,
  sharedStatus: true,
  template: true,
  navigationMode: true,
  sourceDemandId: true,
  instructorName: true,
  reviewerName: true,
  disclaimer: true,
  contributorName: true,
  updateCadence: true,
  totalDurationSec: true,
  learnersCount: true,
  isFeatured: true,
  publishedAt: true,
  lastUpdatedAt: true,
  createdAt: true,
} satisfies Prisma.CourseSelect;

/** 大纲只含导航字段；正文、HTML、媒体与生成脚本永远不得进入嵌套课程对象。 */
export const LESSON_OUTLINE_SELECT = {
  id: true,
  title: true,
  summary: true,
  contentType: true,
  durationSec: true,
  isFree: true,
  sortOrder: true,
} satisfies Prisma.LessonSelect;
