#!/usr/bin/env bash
set -euo pipefail

# Prisma migrate deploy 在部分 macOS/SQLite 环境对“尚不存在的空库”只返回无细节的
# Schema engine error；同一引擎对已有库正常。先走标准路径，且只在确认数据库完全为空时，
# 用 Prisma 自己生成的基线 SQL 引导一次并写入标准 _prisma_migrations，随后仍回到 migrate deploy。
if npx prisma migrate deploy; then
  exit 0
fi

case "${DATABASE_URL:-}" in
  file:*) ;;
  *) echo "FAIL migrate deploy failed; guarded bootstrap only supports SQLite file URLs"; exit 1 ;;
esac

raw_path="${DATABASE_URL#file:}"
if [[ "$raw_path" = /* ]]; then
  db_path="$raw_path"
else
  db_path="$(pwd)/prisma/${raw_path#./}"
fi

command -v sqlite3 >/dev/null 2>&1 || { echo "FAIL migrate deploy failed and sqlite3 is unavailable"; exit 2; }
table_count=0
if [ -f "$db_path" ]; then
  table_count="$(sqlite3 "$db_path" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"
fi
[ "$table_count" = "0" ] || {
  echo "FAIL migrate deploy failed on a non-empty database; refusing automatic bootstrap"
  exit 3
}

echo "Prisma empty-database engine failed; applying the audited baseline SQL once."
npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260713000100_baseline/migration.sql
npx prisma migrate resolve --applied 20260713000100_baseline
npx prisma migrate deploy
