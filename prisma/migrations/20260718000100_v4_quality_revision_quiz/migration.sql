-- 蓝图 Stage 2/S1/D2：Lesson 质量档案列 + 轻版本化表 + 课件练习结果表。
-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN "qualityJson" TEXT;

-- CreateTable
CREATE TABLE "LessonRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "blocksJson" TEXT,
    "htmlJson" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LessonRevision_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LessonQuizResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "answerIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LessonQuizResult_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LessonRevision_lessonId_createdAt_idx" ON "LessonRevision"("lessonId", "createdAt");

-- CreateIndex
CREATE INDEX "LessonQuizResult_userId_createdAt_idx" ON "LessonQuizResult"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonQuizResult_userId_lessonId_blockId_key" ON "LessonQuizResult"("userId", "lessonId", "blockId");
