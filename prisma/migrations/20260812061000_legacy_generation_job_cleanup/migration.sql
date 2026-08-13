-- 旧版 running 任务没有可验证的 dedupe/lease/fencing owner。
-- 新协议把 leaseUntil=NULL 视为可接管；若继续把它当活任务会永久封死大纲和手工编辑。
-- 发布迁移时一次性 fail-closed，保留 inputJson/resultRef 供用户显式恢复或重新发起。
UPDATE "GenerationJob"
SET
  "status" = 'failed',
  "leaseUntil" = NULL,
  "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP),
  "errorMessage" = COALESCE("errorMessage", 'legacy generation job has no valid lease')
WHERE "status" = 'running'
  AND (
    "dedupeKey" IS NULL
    OR "leaseUntil" IS NULL
    OR "heartbeatAt" IS NULL
    OR "fencingToken" IS NULL
  );
