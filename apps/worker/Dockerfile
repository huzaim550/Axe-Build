# The heavy image: Node 20 + JDK 17 + Android SDK. All toolchains live HERE,
# never on the host. Builds run as a non-root user in ephemeral workspaces.
#
# Build context is the repo root (see docker-compose.yml).

FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless \
      wget unzip git ca-certificates ccache \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

# Everything runs as the stock non-root `node` user (uid 1000). The web image
# uses the same user, so the shared volumes (db-data, artifacts, ...) end up
# writable by both containers regardless of which one initializes them first.
# The SDK is node-owned so Gradle/AGP can auto-install missing SDK components.
RUN mkdir -p /opt/android-sdk /workspaces /cache/gradle /cache/npm /cache/ccache \
             /data/uploads /data/artifacts /data/db /repo \
    && chown -R node:node /opt/android-sdk /workspaces /cache /data /repo

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

USER node

# Android command-line tools + the packages a current Expo (SDK 52/53) Android
# build needs. NDK + CMake are required because the New Architecture (default
# since SDK 52) compiles C++ in the app build.
ARG CMDLINE_TOOLS_VERSION=11076708
RUN cd /tmp \
    && wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" -O cmdline-tools.zip \
    && unzip -q cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools" \
    && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
    && rm cmdline-tools.zip

# Slim on purpose: only what a current Expo (SDK 52/53) build needs. The SDK
# dir is writable by the build user, so Gradle/AGP auto-installs anything an
# older project might additionally require (licenses are pre-accepted).
RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager \
         "platform-tools" \
         "platforms;android-35" \
         "build-tools;35.0.0" \
         "ndk;27.1.12297006" \
         "cmake;3.22.1"

# ---- worker app (Node/TS) ----
WORKDIR /repo

COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node apps/worker/package.json apps/worker/
RUN pnpm install

COPY --chown=node:node packages/db packages/db
COPY --chown=node:node apps/worker apps/worker
RUN pnpm --filter @mybuild/db generate \
    && pnpm --filter @mybuild/db build \
    && pnpm --filter @mybuild/worker build

ENTRYPOINT ["/repo/apps/worker/entrypoint.sh"]
