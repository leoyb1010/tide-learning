import type { Prisma } from "@prisma/client";

/** Keep every presentation fingerprint input in DB projections used by market readers. */
export const MARKET_LESSON_PRESENTATION_SELECT = {
  id: true, title: true, summary: true, sortOrder: true, blocksJson: true,
  qualityJson: true, htmlJson: true, renderSourceHash: true, renderEngine: true, designJson: true,
} satisfies Prisma.LessonSelect;
