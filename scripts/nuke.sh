#!/usr/bin/env bash
# Full teardown: containers, named volumes, built images. Leaves the host pristine.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKER="${DOCKER:-docker}"

"$DOCKER" compose down -v --remove-orphans
"$DOCKER" rmi -f mybuild-web mybuild-worker 2>/dev/null || true

echo ""
echo "Nuked: all mybuild containers, volumes and images are gone."
echo "The only thing left on this machine is the source tree itself."
