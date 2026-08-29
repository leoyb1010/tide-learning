#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${DB_PATH:-$ROOT/dev.db}"
ASSETS_DIR="${ASSETS_DIR:-$ROOT/.data}"
STATE_DIR="${STATE_DIR:-$HOME/Library/Application Support/TideLearning}"
BACKUP_DIR="${BACKUP_DIR:-$STATE_DIR/backups}"
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-$STATE_DIR/backup-encryption.key}"
LABEL="${BACKUP_LAUNCHD_LABEL:-com.tide-learning.backup}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOUR="${BACKUP_HOUR:-3}"
MINUTE="${BACKUP_MINUTE:-30}"
KEEP="${KEEP:-14}"

case "$HOUR" in ''|*[!0-9]*) echo "BACKUP_HOUR must be 0-23" >&2; exit 2;; esac
case "$MINUTE" in ''|*[!0-9]*) echo "BACKUP_MINUTE must be 0-59" >&2; exit 2;; esac
[ "$HOUR" -ge 0 ] && [ "$HOUR" -le 23 ] || { echo "BACKUP_HOUR must be 0-23" >&2; exit 2; }
[ "$MINUTE" -ge 0 ] && [ "$MINUTE" -le 59 ] || { echo "BACKUP_MINUTE must be 0-59" >&2; exit 2; }
case "$KEEP" in ''|*[!0-9]*) echo "KEEP must be 1-365" >&2; exit 2;; esac
[ "$KEEP" -ge 1 ] && [ "$KEEP" -le 365 ] || { echo "KEEP must be 1-365" >&2; exit 2; }
[ -f "$DB_PATH" ] || { echo "database not found: $DB_PATH" >&2; exit 2; }

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$STATE_DIR" "$BACKUP_DIR"
if [ ! -s "$PASSWORD_FILE" ]; then
  umask 077
  openssl rand -base64 48 > "$PASSWORD_FILE"
fi
chmod 600 "$PASSWORD_FILE"

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$(command -v node)")</string>
    <string>$(xml_escape "$ROOT/scripts/run-backup-launchagent.mjs")</string>
    <string>$(xml_escape "$DB_PATH")</string>
    <string>$(xml_escape "$BACKUP_DIR")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ASSETS_DIR</key><string>$(xml_escape "$ASSETS_DIR")</string>
    <key>BACKUP_ENCRYPTION_PASSWORD_FILE</key><string>$(xml_escape "$PASSWORD_FILE")</string>
    <key>REQUIRE_ENCRYPTION</key><string>1</string>
    <key>KEEP</key><string>$(xml_escape "$KEEP")</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$(xml_escape "$STATE_DIR/backup.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$STATE_DIR/backup.err.log")</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
for _ in $(seq 1 120); do
  if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = not running"; then
    break
  fi
  sleep 0.25
done
LAST_EXIT="$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '/last exit code =/{print $5; exit}')"
if [ -n "$LAST_EXIT" ] && [ "$LAST_EXIT" != "0" ]; then
  echo "Initial backup failed with exit code $LAST_EXIT; inspect $STATE_DIR/backup.err.log" >&2
  exit 3
fi
echo "Installed $LABEL: daily $(printf '%02d:%02d' "$HOUR" "$MINUTE"), encrypted backups in $BACKUP_DIR"
