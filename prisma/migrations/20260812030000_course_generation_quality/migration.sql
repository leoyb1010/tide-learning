-- 持久化整课终审结果，避免 gen-progress 轮询重复付费，并让 ready 状态有可审计证据。
ALTER TABLE "Course" ADD COLUMN "generationQualityJson" TEXT;
