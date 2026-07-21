ALTER TABLE "Course" ADD COLUMN "customTemplateId" TEXT;
ALTER TABLE "Course" ADD COLUMN "customThemeId" TEXT;
ALTER TABLE "Course" ADD COLUMN "navigationMode" TEXT NOT NULL DEFAULT 'linear';

CREATE TABLE "Template" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "structureJson" TEXT NOT NULL,
  "sourceCourseId" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Template_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Template_slug_key" ON "Template"("slug");
CREATE INDEX "Template_ownerId_updatedAt_idx" ON "Template"("ownerId", "updatedAt");
CREATE INDEX "Template_visibility_status_updatedAt_idx" ON "Template"("visibility", "status", "updatedAt");

CREATE TABLE "Theme" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "tokensJson" TEXT NOT NULL,
  "sourceLessonId" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Theme_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Theme_slug_key" ON "Theme"("slug");
CREATE INDEX "Theme_ownerId_updatedAt_idx" ON "Theme"("ownerId", "updatedAt");
CREATE INDEX "Theme_visibility_status_updatedAt_idx" ON "Theme"("visibility", "status", "updatedAt");

CREATE TABLE "LessonEdge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "courseId" TEXT NOT NULL,
  "fromLessonId" TEXT NOT NULL,
  "toLessonId" TEXT NOT NULL,
  "label" TEXT,
  "conditionJson" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonEdge_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LessonEdge_fromLessonId_fkey" FOREIGN KEY ("fromLessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LessonEdge_toLessonId_fkey" FOREIGN KEY ("toLessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LessonEdge_fromLessonId_toLessonId_label_key" ON "LessonEdge"("fromLessonId", "toLessonId", "label");
CREATE INDEX "LessonEdge_courseId_fromLessonId_sortOrder_idx" ON "LessonEdge"("courseId", "fromLessonId", "sortOrder");
CREATE INDEX "LessonEdge_toLessonId_idx" ON "LessonEdge"("toLessonId");
