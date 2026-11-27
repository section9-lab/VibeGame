#!/usr/bin/env bash
set -euo pipefail

# VibeGame macOS arm64 installer.
#
# Default: download the latest GitHub Release DMG, verify SHA256, install to
# /Applications (or ~/Applications), remove quarantine, and open the app.
#
# Optional:
#   VIBEGAME_VERSION=0.1.0   install a specific release tag
#   VIBEGAME_DMG=/path.dmg   install from a local DMG (offline/testing)
#   VIBEGAME_REPO=owner/repo override the GitHub repository

REPO="${VIBEGAME_REPO:-section9-lab/VibeGame}"
APP_NAME="VibeGame"
APP_BUNDLE="VibeGame.app"
DMG_NAME="macos-arm64-VibeGame.dmg"
VERSION="${VIBEGAME_VERSION:-latest}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only supports macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This build only supports Apple Silicon (arm64). Detected: $(uname -m)." >&2
  exit 1
fi

for bin in curl hdiutil shasum ditto xattr open; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required command: $bin" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vibegame-install.XXXXXX")"
MOUNT_POINT="$TMP_DIR/mount"
DMG_PATH="$TMP_DIR/$DMG_NAME"
CHECKSUM_PATH="$TMP_DIR/SHA256SUMS.txt"
MOUNTED=0

cleanup() {
  if [[ "$MOUNTED" -eq 1 ]]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ -n "${VIBEGAME_DMG:-}" ]]; then
  DMG_PATH="$VIBEGAME_DMG"
  if [[ ! -f "$DMG_PATH" ]]; then
    echo "Local DMG not found: $DMG_PATH" >&2
    exit 1
  fi
  echo "Using local DMG: $DMG_PATH"
else
  if [[ "$VERSION" == "latest" || -z "$VERSION" ]]; then
    BASE_URL="https://github.com/$REPO/releases/latest/download"
  else
    VERSION="${VERSION#v}"
    BASE_URL="https://github.com/$REPO/releases/download/v$VERSION"
  fi

  echo "Downloading $APP_NAME $VERSION ..."
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$BASE_URL/$DMG_NAME" \
    -o "$DMG_PATH"
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$BASE_URL/SHA256SUMS.txt" \
    -o "$CHECKSUM_PATH"

  echo "Verifying SHA256 ..."
  (
    cd "$TMP_DIR"
    grep "  $DMG_NAME\$" "$CHECKSUM_PATH" | shasum -a 256 -c -
  )
fi

mkdir -p "$MOUNT_POINT"
echo "Mounting DMG ..."
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" >/dev/null
MOUNTED=1

SOURCE_APP="$MOUNT_POINT/$APP_BUNDLE"
if [[ ! -d "$SOURCE_APP" ]]; then
  echo "App not found in DMG: $SOURCE_APP" >&2
  exit 1
fi

if [[ -w /Applications ]]; then
  TARGET_APP="/Applications/$APP_BUNDLE"
else
  TARGET_APP="$HOME/Applications/$APP_BUNDLE"
  mkdir -p "$HOME/Applications"
fi

echo "Quitting running $APP_NAME ..."
osascript -e 'tell application "VibeGame" to quit' >/dev/null 2>&1 || true
pkill -f "VibeGame.app/Contents/MacOS" >/dev/null 2>&1 || true
sleep 1

echo "Installing to $TARGET_APP ..."
rm -rf "$TARGET_APP"
ditto "$SOURCE_APP" "$TARGET_APP"
xattr -cr "$TARGET_APP"

echo "Opening $APP_NAME ..."
open "$TARGET_APP"

echo "Done: $TARGET_APP"
