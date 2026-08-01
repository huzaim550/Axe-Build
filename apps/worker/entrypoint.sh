#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Android SDK bootstrap (one time, into the android-sdk volume)
#
# The SDK is NOT in the image. Baking it in meant every `make up --build` or
# `make nuke` re-downloaded ~4GB of SDK/NDK. Here it lands on a named volume
# that outlives images and containers, so this whole block is a no-op on every
# start after the first. Licenses land in the volume too, which means the
# components AGP auto-installs mid-build now survive container recreation.
# ---------------------------------------------------------------------------
ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
CMDLINE_TOOLS_VERSION="${CMDLINE_TOOLS_VERSION:-11076708}"
# Slim on purpose: only what a current Expo (SDK 56 / RN 0.85) build needs.
# These track react-native/gradle/libs.versions.toml: compileSdk 36,
# buildTools 36.0.0, ndk 27.1.12297006, and RN's cmake 3.30.5. NDK + CMake are
# required because the New Architecture compiles C++ in the app build.
# Older projects pinning API 35 / cmake 3.22.1 auto-install them at build time.
ANDROID_SDK_PACKAGES="${ANDROID_SDK_PACKAGES:-platform-tools platforms;android-36 build-tools;36.0.0 ndk;27.1.12297006 cmake;3.30.5}"
SDK_MANIFEST="$ANDROID_HOME/.mybuild-sdk-manifest"

if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "==> Bootstrapping Android command-line tools (one time, ~150MB)"
  rm -rf "$ANDROID_HOME/cmdline-tools"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
       -O /tmp/cmdline-tools.zip
  unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -f /tmp/cmdline-tools.zip
fi

# sdkmanager is idempotent, so editing ANDROID_SDK_PACKAGES only pulls the delta.
if [ "$(cat "$SDK_MANIFEST" 2>/dev/null)" != "$ANDROID_SDK_PACKAGES" ]; then
  echo "==> Installing Android SDK packages (one time, several GB — this is slow):"
  echo "    $ANDROID_SDK_PACKAGES"
  yes | sdkmanager --licenses > /dev/null
  # Word splitting is intentional: one shell word per SDK package.
  # shellcheck disable=SC2086
  sdkmanager $ANDROID_SDK_PACKAGES
  printf '%s' "$ANDROID_SDK_PACKAGES" > "$SDK_MANIFEST"
  echo "==> Android SDK ready. Later starts reuse the android-sdk volume."
fi

# Cap the Gradle build JVM from outside every project: settings in
# GRADLE_USER_HOME take precedence over any project gradle.properties,
# so no uploaded project can blow past the container's memory budget.
GRADLE_USER_HOME="${GRADLE_USER_HOME:-/cache/gradle}"
mkdir -p "$GRADLE_USER_HOME/init.d"
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
org.gradle.jvmargs=${GRADLE_JVM_ARGS:--Xmx4g -XX:MaxMetaspaceSize=1g}
org.gradle.daemon=false
org.gradle.parallel=true
org.gradle.caching=true
EOF

# Disables Android lint for every build (see the script for why).
cp /repo/apps/worker/gradle/mybuild.init.gradle "$GRADLE_USER_HOME/init.d/"

# ccache dir lives on its own volume so repeat native compiles are near-free.
mkdir -p "${CCACHE_DIR:-/cache/ccache}"

exec node /repo/apps/worker/dist/index.js
