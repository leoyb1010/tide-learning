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
#   UPLOADS_DIR       uploads 目录（默认 ./public/uploads；不存在则跳过打包）
# ============================================================================
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

DB_PATH="${1:-${DB_PATH:-./dev.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-./backups}}"
KEEP="${KEEP:-14}"
UPLOADS_DIR="${UPLOADS_DIR:-./public/uploads}"

# --- 依赖探活 ---------------------------------------------------------------
command -v sqlite3 >/dev/null 2>&1 || { echo "FAIL 前置 · 缺少 sqlite3"; exit 2; }
[ -f "$DB_PATH" ] || { echo "FAIL 前置 · 库文件不存在：$DB_PATH"; exit 2; }

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/tide-$STAMP.db"

# --- 在线热备：.backup 产出事务一致的快照（WAL 安全） ------------------------
sqlite3 "$DB_PATH" ".backup '$DEST'"
echo "✅ DB 备份完成：${DEST}（$(du -h "$DEST" | cut -f1)）"

# --- uploads 目录打包（若存在）----------------------------------------------
if [ -d "$UPLOADS_DIR" ]; then
  TARBALL="$BACKUP_DIR/tide-$STAMP-uploads.tar.gz"
  tar -czf "$TARBALL" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  echo "✅ uploads 打包完成：${TARBALL}（$(du -h "$TARBALL" | cut -f1)）"
fi

# --- 轮转清理：按文件名时间戳倒序，保留最近 KEEP 份 --------------------------
ls -1 "$BACKUP_DIR"/tide-*.db 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r OLD; do
  rm -f "$OLD" "${OLD%.db}-uploads.tar.gz"
  echo "🧹 清理过期备份：$OLD"
done

echo "完成。当前保留 $(ls -1 "$BACKUP_DIR"/tide-*.db 2>/dev/null | wc -l | tr -d ' ') 份 DB 备份（上限 ${KEEP}）。"
