# Next.js dashboard + API. Build context is the repo root (see docker-compose.yml).
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@9

# Same non-root uid as the worker image so the shared volumes (db-data, uploads,
# artifacts) are writable by both containers no matter which initializes them.
RUN mkdir -p /data/db /data/uploads /data/artifacts /repo \
    && chown -R node:node /data /repo

USER node
WORKDIR /repo

COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node apps/web/package.json apps/web/
RUN pnpm install

COPY --chown=node:node packages/db packages/db
COPY --chown=node:node apps/web apps/web

# Dummy URL so PrismaClient can be constructed during `next build`;
# the real DATABASE_URL comes from docker-compose at runtime.
ENV DATABASE_URL="file:/tmp/build-placeholder.db"
RUN pnpm --filter @mybuild/db generate \
    && pnpm --filter @mybuild/db build \
    && pnpm --filter @mybuild/web build

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/repo/apps/web/entrypoint.sh"]
