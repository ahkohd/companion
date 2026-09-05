#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IDF_DIR="$ROOT/.tools/esp-idf"
export IDF_TOOLS_PATH="$ROOT/.tools/espressif"

if [[ ! -d "$IDF_DIR/.git" ]]; then
  mkdir -p "$ROOT/.tools"
  gh repo clone espressif/esp-idf "$IDF_DIR" -- \
    --branch v5.5.5 --depth 1 --recursive --shallow-submodules
fi

if [[ "$(git -C "$IDF_DIR" rev-parse HEAD 2>/dev/null || true)" != "b774170ff46c393eeb5e495ea37936038d3f4f4f" ]]; then
  echo "Expected ESP-IDF v5.5.5 in $IDF_DIR" >&2
  exit 1
fi

"$IDF_DIR/install.sh" esp32s3
