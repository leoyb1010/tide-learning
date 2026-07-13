#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

SOURCE_DB="${1:-}"
TARGET_DB="${2:-}"
UPLOAD_ARCHIVE="${3:-}"
FORCE="${4:-}"
ASSETS_DIR="${ASSETS_DIR:-${UPLOADS_DIR:-./.data}}"
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-}"

[ -n "$SOURCE_DB" ] && [ -n "$TARGET_DB" ] || {
  echo "Usage: bash scripts/restore-db.sh BACKUP_DB TARGET_DB [UPLOAD_ARCHIVE] --force"
  exit 2
}
[ "$FORCE" = "--force" ] || { echo "FAIL restore requires explicit --force"; exit 2; }
command -v sqlite3 >/dev/null 2>&1 || { echo "FAIL missing sqlite3"; exit 2; }
[ -f "$SOURCE_DB" ] || { echo "FAIL backup not found: $SOURCE_DB"; exit 2; }
[[ "$SOURCE_DB$TARGET_DB" != *"'"* ]] || { echo "FAIL apostrophes in paths are not supported"; exit 2; }

MANIFEST_BASE="${SOURCE_DB%.enc}"
MANIFEST="${MANIFEST_BASE%.db}.sha256"
if [ -f "$MANIFEST" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$MANIFEST")" && sha256sum -c "$(basename "$MANIFEST")")
  else
    (cd "$(dirname "$MANIFEST")" && shasum -a 256 -c "$(basename "$MANIFEST")")
  fi
fi

EFFECTIVE_DB="$SOURCE_DB"
TMP_DECRYPT_DB=""
if [[ "$SOURCE_DB" == *.enc ]]; then
  command -v openssl >/dev/null 2>&1 || { echo "FAIL missing openssl"; exit 2; }
  [ -n "$PASSWORD_FILE" ] && [ -r "$PASSWORD_FILE" ] || { echo "FAIL encrypted backup requires BACKUP_ENCRYPTION_PASSWORD_FILE"; exit 2; }
  TMP_DECRYPT_DB="$(mktemp)"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$SOURCE_DB" -out "$TMP_DECRYPT_DB" -pass "file:$PASSWORD_FILE"
  EFFECTIVE_DB="$TMP_DECRYPT_DB"
fi

[ "$(sqlite3 "$EFFECTIVE_DB" "PRAGMA quick_check;")" = "ok" ] || { echo "FAIL backup integrity check"; exit 3; }

mkdir -p "$(dirname "$TARGET_DB")"
if [ -f "$TARGET_DB" ]; then
  SAFETY="$TARGET_DB.pre-restore-$(date +%Y%m%d-%H%M%S)"
  sqlite3 "$TARGET_DB" ".backup '$SAFETY'"
  echo "Safety backup: $SAFETY"
fi

TMP_DB="$TARGET_DB.restore-tmp-$$"
trap 'rm -f "$TMP_DB" "${TMP_DECRYPT_DB:-}" "${TMP_DECRYPT_ARCHIVE:-}"; rm -rf "${TMP_UPLOADS:-}"' EXIT
sqlite3 "$EFFECTIVE_DB" ".backup '$TMP_DB'"
[ "$(sqlite3 "$TMP_DB" "PRAGMA integrity_check;")" = "ok" ] || { echo "FAIL restored database integrity check"; exit 3; }
mv "$TMP_DB" "$TARGET_DB"

if [ -n "$UPLOAD_ARCHIVE" ]; then
  [ -f "$UPLOAD_ARCHIVE" ] || { echo "FAIL upload archive not found: $UPLOAD_ARCHIVE"; exit 2; }
  EFFECTIVE_ARCHIVE="$UPLOAD_ARCHIVE"
  TMP_DECRYPT_ARCHIVE=""
  if [[ "$UPLOAD_ARCHIVE" == *.enc ]]; then
    command -v openssl >/dev/null 2>&1 || { echo "FAIL missing openssl"; exit 2; }
    [ -n "$PASSWORD_FILE" ] && [ -r "$PASSWORD_FILE" ] || { echo "FAIL encrypted assets require BACKUP_ENCRYPTION_PASSWORD_FILE"; exit 2; }
    TMP_DECRYPT_ARCHIVE="$(mktemp)"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$UPLOAD_ARCHIVE" -out "$TMP_DECRYPT_ARCHIVE" -pass "file:$PASSWORD_FILE"
    EFFECTIVE_ARCHIVE="$TMP_DECRYPT_ARCHIVE"
  fi
  if tar -tzf "$EFFECTIVE_ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "FAIL unsafe path in upload archive"
    exit 3
  fi
  TMP_UPLOADS="$(mktemp -d)"
  tar -xzf "$EFFECTIVE_ARCHIVE" -C "$TMP_UPLOADS"
  rm -rf "$ASSETS_DIR"
  mkdir -p "$(dirname "$ASSETS_DIR")"
  EXTRACTED="$(find "$TMP_UPLOADS" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$EXTRACTED" ] || { echo "FAIL upload archive has no directory"; exit 3; }
  mv "$EXTRACTED" "$ASSETS_DIR"
fi

echo "Restore complete: $TARGET_DB"
