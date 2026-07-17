#!/bin/bash

set -euo pipefail

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'create-macos-dmg.sh must be run on macOS.' >&2
  exit 1
fi

if [[ "$#" -ne 5 ]]; then
  echo 'Usage: create-macos-dmg.sh <Axiomate.app> <CLI installer> <guide> <background.svg> <output.dmg>' >&2
  exit 1
fi

APP_PATH="$1"
CLI_INSTALLER="$2"
GUIDE_PATH="$3"
BACKGROUND_SVG="$4"
OUTPUT_DMG="$5"
VOLUME_NAME='Axiomate'

for required in "$APP_PATH" "$CLI_INSTALLER" "$GUIDE_PATH" "$BACKGROUND_SVG"; do
  if [[ ! -e "$required" ]]; then
    echo "Required DMG input is missing: $required" >&2
    exit 1
  fi
done

case "$OUTPUT_DMG" in
  /*) ;;
  *) OUTPUT_DMG="$PWD/$OUTPUT_DMG" ;;
esac

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/axiomate-dmg.XXXXXX")"
STAGING_DIR="$WORK_DIR/staging"
MOUNT_DIR=''
RW_DMG="$WORK_DIR/axiomate-rw.dmg"
MOUNTED=0

cleanup() {
  if [[ "$MOUNTED" == '1' ]]; then
    hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$STAGING_DIR/.background"
ditto "$APP_PATH" "$STAGING_DIR/Axiomate.app"
ditto "$CLI_INSTALLER" "$STAGING_DIR/2. Install CLI.command"
ditto "$GUIDE_PATH" "$STAGING_DIR/Read Me First.txt"
chmod 755 "$STAGING_DIR/2. Install CLI.command"
ln -s /Applications "$STAGING_DIR/Applications"
sips -s format png "$BACKGROUND_SVG" \
  --out "$STAGING_DIR/.background/background.png" >/dev/null

hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  -fs HFS+ \
  -format UDRW \
  -ov \
  "$RW_DMG" >/dev/null

ATTACH_OUTPUT="$(hdiutil attach "$RW_DMG" \
  -readwrite \
  -noverify \
  -noautoopen)"
MOUNT_DIR="$(printf '%s\n' "$ATTACH_OUTPUT" | awk -F '\t' 'NF >= 3 { mount = $NF } END { print mount }')"
if [[ -z "$MOUNT_DIR" || ! -d "$MOUNT_DIR" ]]; then
  echo 'Failed to determine the mounted DMG path.' >&2
  exit 1
fi
MOUNTED=1
MOUNT_NAME="$(basename "$MOUNT_DIR")"

osascript - "$MOUNT_NAME" <<'APPLESCRIPT'
on run argv
  set volumeName to item 1 of argv
  tell application "Finder"
    tell disk volumeName
    open
    delay 1
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set pathbar visible of container window to false
    set bounds of container window to {100, 100, 760, 693}

    set viewOptions to icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 88
    set text size of viewOptions to 12
    set background picture of viewOptions to file ".background:background.png"

    set position of item "Axiomate.app" of container window to {150, 175}
    set position of item "Applications" of container window to {510, 175}
    set position of item "2. Install CLI.command" of container window to {230, 400}
    set position of item "Read Me First.txt" of container window to {430, 400}

      update without registering applications
      delay 2
      close
    end tell
  end tell
end run
APPLESCRIPT

sync
hdiutil detach "$MOUNT_DIR" >/dev/null
MOUNTED=0

rm -f "$OUTPUT_DMG"
hdiutil convert "$RW_DMG" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  -o "$OUTPUT_DMG" >/dev/null

hdiutil verify "$OUTPUT_DMG" >/dev/null
echo "Created DMG: $OUTPUT_DMG"
