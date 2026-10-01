#!/usr/bin/env bash
set -euo pipefail
umask 077

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

SOURCE_DB="${1:-}"
TARGET_DB="${2:-}"
UPLOAD_ARCHIVE="${3:-}"
FORCE="${4:-}"
ASSETS_DIR="${ASSETS_DIR:-${UPLOADS_DIR:-./.data}}"
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-}"
TMP_DB=""
TMP_DECRYPT_DB=""
TMP_DECRYPT_ARCHIVE=""
TMP_UPLOADS=""
OLD_ASSETS=""
ASSETS_INSTALLED=0
COMMITTED=0
cleanup() {
  status=$?
  # If the database rename fails after assets were installed, roll assets back.
  if [ "$COMMITTED" != "1" ] && [ "$ASSETS_INSTALLED" = "1" ]; then
    rm -rf -- "$ASSETS_DIR"
    if [ -n "$OLD_ASSETS" ]; then mv -- "$OLD_ASSETS" "$ASSETS_DIR"; fi
  fi
  rm -f -- "$TMP_DB" "$TMP_DECRYPT_DB" "$TMP_DECRYPT_ARCHIVE"
  for temporary in "$TMP_DB" "$TMP_DECRYPT_DB"; do
    [ -z "$temporary" ] || rm -f -- "$temporary-wal" "$temporary-shm"
  done
  [ -z "$TMP_UPLOADS" ] || rm -rf -- "$TMP_UPLOADS"
  exit "$status"
}
trap cleanup EXIT

[ -n "$SOURCE_DB" ] && [ -n "$TARGET_DB" ] || {
  echo "Usage: bash scripts/restore-db.sh BACKUP_DB TARGET_DB [UPLOAD_ARCHIVE] --force"
  exit 2
}
[ "$FORCE" = "--force" ] || { echo "FAIL restore requires explicit --force"; exit 2; }
command -v sqlite3 >/dev/null 2>&1 || { echo "FAIL missing sqlite3"; exit 2; }
[ -f "$SOURCE_DB" ] || { echo "FAIL backup not found: $SOURCE_DB"; exit 2; }
[[ "$SOURCE_DB$TARGET_DB" != *"'"* ]] || { echo "FAIL apostrophes in paths are not supported"; exit 2; }

# Restore is an offline operation. Never use the filesystem root, a symlink,
# or a directory containing the database itself as the assets destination.
command -v node >/dev/null 2>&1 || { echo "FAIL missing node"; exit 2; }
node - "$ASSETS_DIR" "$SOURCE_DB" "$TARGET_DB" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [assets, source, target] = process.argv.slice(2).map(p => path.resolve(p));
if (assets === path.parse(assets).root || [source, target].some(p => p === assets || p.startsWith(assets + path.sep)) || (fs.existsSync(assets) && fs.lstatSync(assets).isSymbolicLink())) {
  console.error('FAIL unsafe assets destination'); process.exit(2);
}
NODE

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
sqlite3 "$EFFECTIVE_DB" ".backup '$TMP_DB'"
[ "$(sqlite3 "$TMP_DB" "PRAGMA integrity_check;")" = "ok" ] || { echo "FAIL restored database integrity check"; exit 3; }

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
  if tar -tvzf "$EFFECTIVE_ARCHIVE" | awk '$1 ~ /^[bcp]/{bad=1} $1 ~ /(^|[[:space:]])l|(^|[[:space:]])h/{bad=1} $6 ~ /^\// || $6 ~ /(^|\/)\.\.($|\/)/{bad=1} END{exit bad}' ; then :; else
    echo "FAIL unsafe path in upload archive"
    exit 3
  fi
  TMP_UPLOADS="$(mktemp -d)"
  tar -xzf "$EFFECTIVE_ARCHIVE" -C "$TMP_UPLOADS"
  EXTRACTED="$(find "$TMP_UPLOADS" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$EXTRACTED" ] || { echo "FAIL upload archive has no directory"; exit 3; }
  [ "$(find "$TMP_UPLOADS" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = "1" ] || {
    echo "FAIL upload archive must contain exactly one directory"; exit 3;
  }
  chmod -R u+rwX,go-rwx "$EXTRACTED"
fi

# Commit only after every input has been decrypted, integrity-checked and (when
# present) extracted into a temporary directory. A corrupt archive must never
# leave the database restored while assets remain stale.
if [ -n "${EXTRACTED:-}" ]; then
  mkdir -p "$(dirname "$ASSETS_DIR")"
  if [ -e "$ASSETS_DIR" ]; then
    OLD_ASSETS="$ASSETS_DIR.pre-restore-$(date +%Y%m%d-%H%M%S)-$$"
    mv -- "$ASSETS_DIR" "$OLD_ASSETS"
  fi
  ASSETS_INSTALLED=1
  mv -- "$EXTRACTED" "$ASSETS_DIR"
fi
mv -- "$TMP_DB" "$TARGET_DB"
COMMITTED=1
[ -z "$OLD_ASSETS" ] || echo "Assets safety backup: $OLD_ASSETS"

echo "Restore complete: $TARGET_DB"
