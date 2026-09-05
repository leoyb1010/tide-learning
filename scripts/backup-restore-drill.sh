#!/usr/bin/env bash
set -Eeuo pipefail

# Safe, repeatable backup/restore drill. It never overwrites the source DB.
# Usage: DATABASE_URL=file:/path/to/db npm run check:backup

DB_PATH="${1:-${DATABASE_URL:-file:./dev.db}}"
DB_PATH="${DB_PATH#file:}"
[ -f "$DB_PATH" ] || { echo "FAIL source database not found: $DB_PATH" >&2; exit 2; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tide-backup-drill.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
ASSETS="$ROOT/assets"
BACKUPS="$ROOT/backups"
RESTORED_DB="$ROOT/restored.db"
RESTORED_ASSETS="$ROOT/restored-assets"
PASSWORD_FILE="$ROOT/password"
mkdir -p "$ASSETS/media" "$ASSETS/uploads" "$BACKUPS" "$RESTORED_ASSETS"
printf 'tide-backup-drill-password-v1' > "$PASSWORD_FILE"
printf 'media-drill-fixture' > "$ASSETS/media/drill.bin"
printf 'upload-drill-fixture' > "$ASSETS/uploads/drill.txt"

ASSETS_DIR="$ASSETS" \
REQUIRE_ENCRYPTION=1 \
BACKUP_ENCRYPTION_PASSWORD_FILE="$PASSWORD_FILE" \
bash scripts/backup-db.sh "$DB_PATH" "$BACKUPS" >/dev/null

DB_ARCHIVE="$(find "$BACKUPS" -name '*.db.enc' -print -quit)"
UPLOAD_ARCHIVE="$(find "$BACKUPS" -name '*uploads.tar.gz.enc' -print -quit)"
[ -n "$DB_ARCHIVE" ] && [ -n "$UPLOAD_ARCHIVE" ] || { echo "FAIL encrypted backup artifacts missing" >&2; exit 3; }

BACKUP_ENCRYPTION_PASSWORD_FILE="$PASSWORD_FILE" \
ASSETS_DIR="$RESTORED_ASSETS" \
bash scripts/restore-db.sh "$DB_ARCHIVE" "$RESTORED_DB" "$UPLOAD_ARCHIVE" --force >/dev/null

[ "$(sqlite3 "$RESTORED_DB" 'PRAGMA integrity_check;')" = "ok" ] || { echo "FAIL sqlite integrity check" >&2; exit 4; }
[ "$(shasum -a 256 "$ASSETS/media/drill.bin" | awk '{print $1}')" = "$(shasum -a 256 "$RESTORED_ASSETS/media/drill.bin" | awk '{print $1}')" ] || { echo "FAIL media hash mismatch" >&2; exit 5; }
[ "$(shasum -a 256 "$ASSETS/uploads/drill.txt" | awk '{print $1}')" = "$(shasum -a 256 "$RESTORED_ASSETS/uploads/drill.txt" | awk '{print $1}')" ] || { echo "FAIL upload hash mismatch" >&2; exit 6; }

echo "PASS encrypted backup/restore drill: sqlite integrity and asset hashes verified"
