# syntax=docker/dockerfile:1.7
# Worker image. Build from the repo root: docker build -f infra/docker/worker.Dockerfile -t nibras-worker .
# BullMQ worker; health server on WORKER_PORT (default 3002). Never runs migrations.

ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS base
# openssl: Prisma's engines detect libssl through it.
RUN apk add --no-cache libc6-compat openssl \
 && npm install -g --no-fund --no-audit pnpm@10.34.6 turbo@2.11.7
ENV TURBO_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN turbo prune @nibras/worker --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@nibras/worker
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

FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache libc6-compat openssl
# No package manager at runtime (SP1.6 F10): npm, npx, corepack and yarn ship with the base image,
# are never used by the app and carry their own advisories (trivy image gate in ci.yml).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
# APP_ENV (deployment tier) is never unset in an image; compose overrides it (staging).
ENV NODE_ENV=production \
    APP_ENV=production \
    WORKER_PORT=3002
WORKDIR /app
RUN addgroup -S -g 1001 nibras && adduser -S -u 1001 -G nibras nibras
COPY --from=builder /repo .
USER nibras
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${WORKER_PORT}/health/live" || exit 1
CMD ["node", "apps/worker/dist/main.js"]
