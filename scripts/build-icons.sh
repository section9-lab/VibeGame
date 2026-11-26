#!/usr/bin/env bash
# 从 SVG 生成 macOS 图标。不要用 qlmanage：它会把透明区域压成白底。
set -euo pipefail
cd "$(dirname "$0")/.."

branding="resources/branding"
source_svg="$branding/vibegame-appicon.svg"
master="$(mktemp -t vibegame-icon).png"

sips -s format png "$source_svg" --out "$master" >/dev/null

rm -rf "$branding/vibegame.iconset" "$branding/vibegame.icns"
mkdir -p "$branding/vibegame.iconset"
cp "$master" "$branding/vibegame-appicon.png"

while IFS=: read -r name size; do
	sips -z "$size" "$size" "$master" --out "$branding/vibegame.iconset/$name" >/dev/null
done <<'SIZES'
icon_16x16.png:16
icon_16x16@2x.png:32
icon_32x32.png:32
icon_32x32@2x.png:64
icon_128x128.png:128
icon_128x128@2x.png:256
icon_256x256.png:256
icon_256x256@2x.png:512
icon_512x512.png:512
icon_512x512@2x.png:1024
SIZES

iconutil -c icns "$branding/vibegame.iconset" -o "$branding/vibegame.icns"
rm -f "$master"

printf 'wrote %s\n' "$branding/vibegame.icns"
