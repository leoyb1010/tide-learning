#!/usr/bin/env bash
# ============================================================================
# SQLite 在线备份（生产运维）
# ----------------------------------------------------------------------------
# 目的：对运行中的生产库做一致性热备。用 sqlite3 的 .backup 命令（走 SQLite
#       Online Backup API，WAL 模式下安全），绝不可直接 cp 库文件——
#       WAL 未 checkpoint 时会拷出损坏/落后的快照。
#
# 行为：
#   - 备份 DB 到 <BACKUP_DIR>/tide-YYYYmmdd-HHMMSS.db；
#   - uploads 目录存在时一并打包为同时间戳的 tide-*-uploads.tar.gz
#     （DB + 用户上传文件才是完整可恢复备份）；
#   - 按时间戳保留最近 KEEP 份（默认 14），更早的 DB 与对应 uploads 包同步清理。
#
# 用法：bash scripts/backup-db.sh [DB_PATH] [BACKUP_DIR]
# 可配（位置参数优先于环境变量）：
#   $1 / DB_PATH      SQLite 库文件路径（默认 ./dev.db；生产传 /var/lib/tide/prod.db）
#   $2 / BACKUP_DIR   备份目录（默认 ./backups）
#   KEEP              保留份数（默认 14）
#   ASSETS_DIR        私有资产根目录（默认 ./.data，同时包含 uploads 和 media）
#   BACKUP_ENCRYPTION_PASSWORD_FILE  OpenSSL AES-256 密码文件；设置后仅保留 .enc 密文
#   REQUIRE_ENCRYPTION  设为 1 时，未提供密码文件即失败（生产应固定为 1）
# ============================================================================
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

DB_PATH="${1:-${DB_PATH:-./dev.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-./backups}}"
KEEP="${KEEP:-14}"
ASSETS_DIR="${ASSETS_DIR:-${UPLOADS_DIR:-./.data}}"
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-}"
REQUIRE_ENCRYPTION="${REQUIRE_ENCRYPTION:-0}"

# --- 依赖探活 ---------------------------------------------------------------
command -v sqlite3 >/dev/null 2>&1 || { echo "FAIL 前置 · 缺少 sqlite3"; exit 2; }
[ -f "$DB_PATH" ] || { echo "FAIL 前置 · 库文件不存在：$DB_PATH"; exit 2; }
if [ "$REQUIRE_ENCRYPTION" = "1" ] && [ -z "$PASSWORD_FILE" ]; then
  echo "FAIL 前置 · 生产备份要求 BACKUP_ENCRYPTION_PASSWORD_FILE"
  exit 2
fi
if [ -n "$PASSWORD_FILE" ]; then
  command -v openssl >/dev/null 2>&1 || { echo "FAIL 前置 · 缺少 openssl"; exit 2; }
  [ -r "$PASSWORD_FILE" ] || { echo "FAIL 前置 · 密码文件不可读：$PASSWORD_FILE"; exit 2; }
  [ "$(wc -c < "$PASSWORD_FILE" | tr -d ' ')" -ge 20 ] || { echo "FAIL 前置 · 备份密码至少 20 字节"; exit 2; }
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/tide-$STAMP.db"

# --- 在线热备：.backup 产出事务一致的快照（WAL 安全） ------------------------
sqlite3 "$DB_PATH" ".backup '$DEST'"
[ "$(sqlite3 "$DEST" "PRAGMA quick_check;")" = "ok" ] || { echo "FAIL 备份完整性校验失败"; rm -f "$DEST"; exit 3; }
# quick_check 打开继承 WAL 模式的快照时可能创建 -wal/-shm；这些不是备份产物，
# 加密模式下更不能作为明文旁文件残留在备份目录。
rm -f "$DEST-wal" "$DEST-shm"
echo "✅ DB 备份完成：${DEST}（$(du -h "$DEST" | cut -f1)）"

# --- uploads 目录打包（若存在）----------------------------------------------
if [ -d "$ASSETS_DIR" ]; then
  TARBALL="$BACKUP_DIR/tide-$STAMP-uploads.tar.gz"
  tar -czf "$TARBALL" -C "$(dirname "$ASSETS_DIR")" "$(basename "$ASSETS_DIR")"
  echo "✅ 私有资产打包完成：${TARBALL}（$(du -h "$TARBALL" | cut -f1)）"
fi

# --- 可选强制加密：生产仅保留 AES-256-CBC(PBKDF2) 密文 ---------------------
BACKUP_FILES=("$DEST")
if [ -n "${TARBALL:-}" ]; then BACKUP_FILES+=("$TARBALL"); fi
if [ -n "$PASSWORD_FILE" ]; then
  ENCRYPTED_FILES=()
  for FILE in "${BACKUP_FILES[@]}"; do
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -in "$FILE" -out "$FILE.enc" -pass "file:$PASSWORD_FILE"
    rm -f "$FILE"
    ENCRYPTED_FILES+=("$FILE.enc")
  done
  BACKUP_FILES=("${ENCRYPTED_FILES[@]}")
  echo "✅ 备份加密完成：仅保留 ${#BACKUP_FILES[@]} 个 .enc 密文"
fi

# --- 校验清单：恢复前可验证备份未被截断或篡改 -------------------------------
MANIFEST="$BACKUP_DIR/tide-$STAMP.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "${BACKUP_FILES[@]##*/}") > "$MANIFEST"
else
  (cd "$BACKUP_DIR" && shasum -a 256 "${BACKUP_FILES[@]##*/}") > "$MANIFEST"
fi
echo "✅ 校验清单完成：${MANIFEST}"

# --- 轮转清理：按文件名时间戳倒序，保留最近 KEEP 份 --------------------------
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'tide-*.db' -o -name 'tide-*.db.enc' \) | sort -r | tail -n +$((KEEP + 1)) | while read -r OLD; do
  BASE="${OLD%.enc}"
  BASE="${BASE%.db}"
  rm -f "$BASE.db" "$BASE.db.enc" "$BASE-uploads.tar.gz" "$BASE-uploads.tar.gz.enc" "$BASE.sha256"
  echo "🧹 清理过期备份：$OLD"
done

COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'tide-*.db' -o -name 'tide-*.db.enc' \) | wc -l | tr -d ' ')"
echo "完成。当前保留 ${COUNT} 份 DB 备份（上限 ${KEEP}）。"
