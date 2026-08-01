#!/usr/bin/env bash
# Full teardown: containers, named volumes, built images. Leaves the host pristine.
#
# One deliberate exception: the android-sdk volume is KEPT. It is several GB
# pulled over a home connection and nothing in it is project state. Use
# `make nuke-sdk` (or pass --sdk here) when you want that gone too.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKER="${DOCKER:-docker}"

# Every volume in docker-compose.yml except android-sdk, compose-prefixed.
VOLUMES=(
  mybuild_redis-data
  mybuild_db-data
  mybuild_uploads
  mybuild_artifacts
  mybuild_workspaces
  mybuild_gradle-cache
  mybuild_npm-cache
  mybuild_ccache
)

NUKE_SDK=0
if [ "${1:-}" = "--sdk" ]; then
  NUKE_SDK=1
  VOLUMES+=(mybuild_android-sdk)
fi

# NOT `down -v`: that would take android-sdk with it.
"$DOCKER" compose down --remove-orphans
"$DOCKER" volume rm -f "${VOLUMES[@]}" 2>/dev/null || true
"$DOCKER" rmi -f mybuild-web mybuild-worker 2>/dev/null || true

echo ""
echo "Nuked: all mybuild containers, images, and state volumes are gone."
if [ "$NUKE_SDK" = "1" ]; then
  echo "The Android SDK volume was dropped too — the next 'make up' re-downloads it."
else
  echo "Kept: the android-sdk volume, so the next 'make up' does NOT re-download"
  echo "the SDK/NDK. Run 'make nuke-sdk' if you want a clean SDK as well."
fi
