#!/usr/bin/env bash
# M5「打磨与分发」：Release 构建 YoudaoStudioMac + 打未签名 dmg 供内测。
#
# 本机仅 Apple Development 证书（无 Developer ID），故 dmg 未签名 / 未公证：
# 首次打开需右键「打开」或到「系统设置 > 隐私与安全性」放行。仅供内部尝鲜。
#
# 用法：bash scripts/build-mac-dmg.sh
# 产物：dist/有道自习室-<version>.dmg
set -euo pipefail

# 仓库根（脚本在 scripts/ 下）。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT/ios"
DIST_DIR="$ROOT/dist"
SCHEME="YoudaoStudioMac"
APP_NAME="YoudaoStudioMac.app"
DMG_VOL="有道自习室"

# 构建产物落到独立目录，避免 DerivedData 路径漂移。
BUILD_DIR="$(mktemp -d /tmp/youdao-mac-build.XXXXXX)"
STAGE_DIR="$(mktemp -d /tmp/youdao-mac-stage.XXXXXX)"
trap 'rm -rf "$BUILD_DIR" "$STAGE_DIR"' EXIT

echo "==> [1/4] xcodegen generate"
( cd "$IOS_DIR" && xcodegen generate )

echo "==> [2/4] xcodebuild Release ($SCHEME)"
xcodebuild \
  -project "$IOS_DIR/YoudaoStudio.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'platform=macOS' \
  CONFIGURATION_BUILD_DIR="$BUILD_DIR" \
  build \
  | tail -3

APP_PATH="$BUILD_DIR/$APP_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: 未找到构建产物 $APP_PATH" >&2
  exit 1
fi

# 读营销版本用于 dmg 命名（取自 .app/Contents/Info.plist）。
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo 1.0)"

echo "==> [3/4] 组织 dmg 内容（.app + /Applications 快捷方式）"
mkdir -p "$DIST_DIR"
cp -R "$APP_PATH" "$STAGE_DIR/"
ln -s /Applications "$STAGE_DIR/Applications"

DMG_PATH="$DIST_DIR/${DMG_VOL}-${VERSION}.dmg"
rm -f "$DMG_PATH"

echo "==> [4/4] hdiutil create（未签名内测 dmg）"
hdiutil create \
  -volname "$DMG_VOL" \
  -srcfolder "$STAGE_DIR" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "$DMG_PATH" \
  >/dev/null

echo ""
echo "✅ 完成：$DMG_PATH"
ls -la "$DMG_PATH"
