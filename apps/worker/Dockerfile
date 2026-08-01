# Node 20 + JDK 17. Toolchains live in the container, never on the host, and
# builds run as a non-root user in ephemeral workspaces.
#
# The Android SDK is deliberately NOT baked in: it lives on the `android-sdk`
# named volume and entrypoint.sh downloads it once, on first start. Baking it
# in made every image rebuild re-download ~4GB of SDK/NDK and pushed the image
# past 8GB. See entrypoint.sh for the bootstrap.
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
#
# /opt/android-sdk is created empty and node-owned ON PURPOSE: an empty named
# volume is seeded from the image directory it mounts over, ownership included,
# so the SDK volume comes up writable by the build user with no runtime chown.
RUN mkdir -p /opt/android-sdk /workspaces /cache/gradle /cache/npm /cache/ccache \
             /data/uploads /data/artifacts /data/db /repo \
    && chown -R node:node /opt/android-sdk /workspaces /cache /data /repo

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

USER node

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
