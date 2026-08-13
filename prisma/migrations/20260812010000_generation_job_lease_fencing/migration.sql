-- GenerationJob 可续租所有权协议。
-- 新字段全部 nullable：历史行无需回填或重建表，SQLite 可在线追加列。
ALTER TABLE "GenerationJob" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "GenerationJob" ADD COLUMN "leaseUntil" DATETIME;
ALTER TABLE "GenerationJob" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "GenerationJob" ADD COLUMN "fencingToken" INTEGER;

-- SQLite UNIQUE 允许多个 NULL：历史 job 保持原样；所有新协议 job 的非空 dedupeKey 一键一行。
CREATE UNIQUE INDEX "GenerationJob_dedupeKey_key" ON "GenerationJob"("dedupeKey");

-- 供过期 running job 扫描/接管；不替换既有 userId/status 与 type/resultRef 热路径索引。
CREATE INDEX "GenerationJob_status_leaseUntil_idx" ON "GenerationJob"("status", "leaseUntil");
