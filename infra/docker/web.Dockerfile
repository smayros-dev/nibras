# syntax=docker/dockerfile:1.7
# Web image (Next.js standalone output). Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile -t tt-web .
# API_URL is baked into the `/api/*` rewrite at build time (next.config.ts) and also read at runtime
# by server components; the default targets the `api` service of infra/compose.staging.yml.

ARG NODE_IMAGE=node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat \
 && npm install -g --no-fund --no-audit pnpm@10.34.6 turbo@2.11.7
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN turbo prune @tt/web --docker

FROM base AS builder
ARG API_URL=http://api:3001
ENV API_URL=${API_URL}
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@tt/web

# Runtime: only the standalone server (traced node_modules) and static assets.
FROM ${NODE_IMAGE} AS runner
ARG API_URL=http://api:3001
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    API_URL=${API_URL} \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S -g 1001 tt && adduser -S -u 1001 -G tt tt
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
# Next writes its fetch/image cache here at runtime; everything else stays root-owned.
RUN mkdir -p apps/web/.next/cache && chown tt:tt apps/web/.next/cache
USER tt
EXPOSE 3000
# Probes ${PORT}, the port the server listens on. compose.staging.yml pins PORT per service because
# the shared .env.staging would otherwise override it (healthy, yet listening on the wrong port).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1
CMD ["node", "apps/web/server.js"]
