DROP INDEX IF EXISTS "Lesson_videoAssetId_idx";
CREATE UNIQUE INDEX "Lesson_videoAssetId_key" ON "Lesson"("videoAssetId");
