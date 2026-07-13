#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
DB="$TMP/legacy.db"
trap 'rm -rf "$TMP"' EXIT

sqlite3 "$DB" < "$ROOT/prisma/migrations/20260713000100_baseline/migration.sql"
sqlite3 "$DB" <<'SQL'
INSERT INTO "Course" ("id", "slug", "title", "category", "level") VALUES ('legacy-course', 'legacy-course', 'Legacy Course', 'ai_skill', 'L1');
INSERT INTO "Lesson" ("id", "courseId", "title", "videoAssetId", "videoGenStatus") VALUES ('legacy-lesson', 'legacy-course', 'Legacy Lesson', 'asset_legacy', 'ready');
SQL

cd "$ROOT"
DATABASE_URL="file:$DB" npx prisma migrate resolve --applied 20260713000100_baseline >/dev/null
DATABASE_URL="file:$DB" npx prisma migrate deploy >/dev/null

test "$(sqlite3 "$DB" 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;')" = "4"
test "$(sqlite3 "$DB" 'SELECT videoAssetId IS NULL AND videoGenStatus = "failed" FROM Lesson WHERE id = "legacy-lesson";')" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_index_list('Lesson') WHERE name='Lesson_videoAssetId_key' AND \"unique\"=1;")" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_table_info('PaymentWebhookLog') WHERE name='processingStartedAt';")" = "1"
echo "legacy migration verified: baseline -> latest"
