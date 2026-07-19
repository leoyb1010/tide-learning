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

# 已应用数须等于 migrations 目录数(动态计数:此前硬编码 4,每加一个迁移就断 CI)。
EXPECTED_MIGRATIONS="$(find "$ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
test "$(sqlite3 "$DB" 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;')" = "$EXPECTED_MIGRATIONS"
test "$(sqlite3 "$DB" 'SELECT videoAssetId IS NULL AND videoGenStatus = "failed" FROM Lesson WHERE id = "legacy-lesson";')" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_index_list('Lesson') WHERE name='Lesson_videoAssetId_key' AND \"unique\"=1;")" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_table_info('PaymentWebhookLog') WHERE name='processingStartedAt';")" = "1"
# v4 迁移效果:quiz 结果表 + Lesson.qualityJson(20260718)、ReviewCard FSRS 列(20260719)。
test "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='LessonQuizResult';")" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_table_info('Lesson') WHERE name='qualityJson';")" = "1"
test "$(sqlite3 "$DB" "SELECT count(*) FROM pragma_table_info('ReviewCard') WHERE name='stability';")" = "1"
echo "legacy migration verified: baseline -> latest ($EXPECTED_MIGRATIONS migrations)"
