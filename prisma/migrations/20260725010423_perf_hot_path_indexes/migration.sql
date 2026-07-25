-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Course_status_visibility_idx" ON "Course"("status", "visibility");

-- CreateIndex
CREATE INDEX "GenerationJob_type_resultRef_createdAt_idx" ON "GenerationJob"("type", "resultRef", "createdAt");

-- CreateIndex
CREATE INDEX "LearningProgress_lastPlayedAt_idx" ON "LearningProgress"("lastPlayedAt");
