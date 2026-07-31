#!/bin/sh
set -e

# Sync the SQLite schema on the db-data volume (idempotent), then serve.
cd /repo
pnpm --filter @mybuild/db exec prisma db push --skip-generate

exec pnpm --filter @mybuild/web start
