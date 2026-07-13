-- 旧 seed / mock 上传曾把 asset_*、mockvid_* 占位符写进 videoAssetId。
-- 生产私有存储只接受 media_<uuid>；清理必然 404 的旧引用，并把伪 ready 改为可重试失败态。
UPDATE "Lesson"
SET
  "videoAssetId" = NULL,
  "videoGenStatus" = CASE WHEN "videoGenStatus" = 'ready' THEN 'failed' ELSE "videoGenStatus" END
WHERE "videoAssetId" IS NOT NULL
  AND "videoAssetId" NOT LIKE 'media_%';
