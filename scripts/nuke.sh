#!/usr/bin/env bash
# Full teardown: containers, named volumes, built images. Leaves the host pristine.
#
# Two deliberate exceptions, both kept unless you ask for them by name:
#   - android-sdk: several GB pulled over a home connection, and nothing in it
#     is project state. Use `make nuke-sdk` (or --sdk here) to drop it.
#   - keystores: your release signing keys. These are the one thing here that
#     cannot be rebuilt from anything — lose them and no future build can ever
#     upgrade an app somebody already installed. Pass --keystores to drop them.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKER="${DOCKER:-docker}"

# Every volume in docker-compose.yml except android-sdk and keystores, compose-prefixed.
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
NUKE_KEYSTORES=0
for arg in "$@"; do
  case "$arg" in
    --sdk)
      NUKE_SDK=1
      VOLUMES+=(mybuild_android-sdk)
      ;;
    --keystores)
      NUKE_KEYSTORES=1
      VOLUMES+=(mybuild_keystores)
      ;;
    *)
      echo "Unknown option: $arg (expected --sdk and/or --keystores)" >&2
      exit 2
      ;;
  esac
done

# NOT `down -v`: that would take android-sdk with it.
"$DOCKER" compose down --remove-orphans
"$DOCKER" volume rm -f "${VOLUMES[@]}" 2>/dev/null || true
# Both names: images were tagged mybuild-* before the project was renamed.
"$DOCKER" rmi -f axebuild-web axebuild-worker mybuild-web mybuild-worker 2>/dev/null || true

echo ""
echo "Nuked: all Axe Build containers, images, and state volumes are gone."
if [ "$NUKE_SDK" = "1" ]; then
  echo "The Android SDK volume was dropped too — the next 'make up' re-downloads it."
else
  echo "Kept: the android-sdk volume, so the next 'make up' does NOT re-download"
  echo "the SDK/NDK. Run 'make nuke-sdk' if you want a clean SDK as well."
fi
if [ "$NUKE_KEYSTORES" = "1" ]; then
  echo "Your release keystores were deleted. Apps signed with them can no longer"
  echo "be updated in place unless you restore the keys from a backup."
else
  echo "Kept: the keystores volume, so signed apps can still be updated. Pass"
  echo "--keystores if you really want the signing keys gone."
fi
