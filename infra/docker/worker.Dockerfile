# syntax=docker/dockerfile:1.7
# Worker image. Build from the repo root: docker build -f infra/docker/worker.Dockerfile -t tt-worker .
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

FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache libc6-compat openssl
# APP_ENV (deployment tier) is never unset in an image; compose overrides it (staging).
ENV NODE_ENV=production \
    APP_ENV=production \
    WORKER_PORT=3002
WORKDIR /app
RUN addgroup -S -g 1001 tt && adduser -S -u 1001 -G tt tt
COPY --from=builder /repo .
USER tt
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${WORKER_PORT}/health/live" || exit 1
CMD ["node", "apps/worker/dist/main.js"]
