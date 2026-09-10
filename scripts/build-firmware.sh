#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
node scripts/build-face-profiles.mjs
node scripts/build-design-schema.mjs
node scripts/build-reicon-icons.mjs
node firmware/tools/build-music-badges.mjs
if [[ -f firmware/sdkconfig ]] && rg -q '^CONFIG_SPIRAM_(RODATA|XIP_FROM_PSRAM)=y$' firmware/sdkconfig; then
  echo "Disable SPIRAM_RODATA and SPIRAM_XIP_FROM_PSRAM in firmware/sdkconfig: keep read-only assets in flash to preserve PSRAM for rendering." >&2
  exit 1
fi
IDF_DIR="$ROOT/.tools/esp-idf"
export IDF_TOOLS_PATH="$ROOT/.tools/espressif"

if [[ ! -f "$IDF_DIR/export.sh" ]]; then
  echo "Run scripts/setup-firmware.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$IDF_DIR/export.sh" >/dev/null
exec idf.py -C "$ROOT/firmware" -D "COMPANION_BOARD=${COMPANION_BOARD:-waveshare-1.75-b}" build
