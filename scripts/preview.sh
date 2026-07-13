#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${PREVIEW_DB_PATH:-$ROOT/prisma/dev.db}"
PORT="${PORT:-3100}"

[ -f "$DB_PATH" ] || { echo "FAIL preview database not found: $DB_PATH"; exit 2; }

cd "$ROOT"
npm run build
DATABASE_URL="file:$DB_PATH" NODE_ENV=production PORT="$PORT" exec npx next start -p "$PORT"
