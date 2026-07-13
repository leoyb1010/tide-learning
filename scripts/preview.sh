#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${PREVIEW_DB_PATH:-$ROOT/prisma/dev.db}"
PORT="${PORT:-3100}"

[ -f "$DB_PATH" ] || { echo "FAIL preview database not found: $DB_PATH"; exit 2; }

cd "$ROOT"
export ALLOW_LOCAL_PRODUCTION=1
export DATABASE_URL="file:$DB_PATH"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:$PORT"
export NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_SITE_URL"
export NEXT_PUBLIC_PAY_CHANNEL="${NEXT_PUBLIC_PAY_CHANNEL:-mock}"
export STORAGE_MODE=local
export STREAM_SIGNING_SECRET="${STREAM_SIGNING_SECRET:-preview-only-stream-signing-secret-at-least-32-chars}"
npm run build
NODE_ENV=production PORT="$PORT" exec npx next start -p "$PORT"
