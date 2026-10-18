# syntax=docker/dockerfile:1.7
# API image. Build from the repo root: docker build -f infra/docker/api.Dockerfile -t tt-api .
# Run: `docker run tt-api` starts the API; `docker run tt-api migrate` applies Prisma migrations
# (app_system, DATABASE_URL_SYSTEM) and exits. Migrations never run on boot.

ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS base
# openssl: Prisma's engines detect libssl through it.
RUN apk add --no-cache libc6-compat openssl \
 && npm install -g --no-fund --no-audit pnpm@10.34.6 turbo@2.11.7
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm

# 1. Keep only @nibras/api and the workspace packages it depends on.
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN turbo prune @nibras/api --docker

# 2. Install (manifests first, for layer caching), then build.
FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@nibras/api

# 3. Runtime: built workspace (no pnpm/turbo), read-only for the non-root user.
FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache libc6-compat openssl
# APP_ENV (deployment tier) is never unset in an image; compose overrides it (staging).
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3001
WORKDIR /app
RUN addgroup -S -g 1001 tt && adduser -S -u 1001 -G tt tt
COPY --from=builder /repo .
COPY --chmod=755 <<'SH' /usr/local/bin/tt-entrypoint
#!/bin/sh
set -e
if [ "$1" = "migrate" ]; then
  # One-shot: prisma migrate deploy as app_system (schema reads DATABASE_URL_SYSTEM).
  cd /app/packages/db
  exec node node_modules/prisma/build/index.js migrate deploy
fi
exec "$@"
SH
USER tt
EXPOSE 3001
# Probes ${PORT}, the port the server listens on. compose.staging.yml pins PORT per service because
# the shared .env.staging would otherwise override it (healthy, yet listening on the wrong port).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1
ENTRYPOINT ["tt-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
