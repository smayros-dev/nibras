# syntax=docker/dockerfile:1.7
# API image. Build from the repo root: docker build -f infra/docker/api.Dockerfile -t nibras-api .
# Run: `docker run nibras-api` starts the API; `docker run nibras-api migrate` applies Prisma migrations
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
# Production-only tree (SP1.6 F11). `pnpm prune --prod` empties the workspace packages'
# node_modules and `pnpm install --prod` over the dev tree leaves the dev packages in .pnpm, so
# reinstall from scratch without devDependencies (typescript, vitest, eslint, nest cli, swc…) from
# the store, regenerate the Prisma client into the fresh tree, and drop typescript, which pnpm still
# links as the optional peer of prisma/@prisma/client (unused at runtime). Then delete sources,
# tests and tool configs. Kept: every dist/, package.json, node_modules, packages/db/prisma
# (migrations), pnpm-workspace.yaml, the root package.json and .npmrc.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    find . -name node_modules -prune -exec rm -rf {} + \
 && CI=true pnpm install --prod --frozen-lockfile --offline \
 && CHECKPOINT_DISABLE=1 pnpm --filter @nibras/db generate \
 && find node_modules/.pnpm -path '*/node_modules/typescript' -prune -exec rm -rf {} + \
 && rm -rf node_modules/.pnpm/typescript@* \
 && rm -rf apps/*/src apps/*/test packages/*/src packages/*/test packages/*/scripts .turbo \
 && find . -name node_modules -prune -o \( -name .turbo -o -name '*.tsbuildinfo' \
      -o -name 'vitest.config.*' -o -name 'vitest.setup.*' -o -name 'eslint.config.*' \
      -o -name 'tsconfig*.json' \) -prune -exec rm -rf {} +

# 3. Runtime: the pruned workspace (no pnpm/turbo, no sources), read-only for the non-root user.
FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache libc6-compat openssl
# APP_ENV (deployment tier) is never unset in an image; compose overrides it (staging).
# CHECKPOINT_DISABLE / PRISMA_HIDE_UPDATE_MESSAGE: the Prisma CLI (`migrate`) neither phones home nor
# writes its update-check cache under $HOME (staging runs the container with read_only: true).
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3001 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
RUN addgroup -S -g 1001 nibras && adduser -S -u 1001 -G nibras nibras
COPY --from=builder /repo .
COPY --chmod=755 <<'SH' /usr/local/bin/nibras-entrypoint
#!/bin/sh
set -e
if [ "$1" = "migrate" ]; then
  # One-shot: prisma migrate deploy as app_system (schema reads DATABASE_URL_SYSTEM).
  cd /app/packages/db
  exec node node_modules/prisma/build/index.js migrate deploy
fi
exec "$@"
SH
USER nibras
EXPOSE 3001
# Probes ${PORT}, the port the server listens on (compose.staging.yml sets PORT in the service's
# own environment, so the probe and the server always agree).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1
ENTRYPOINT ["nibras-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
