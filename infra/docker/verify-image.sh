#!/usr/bin/env bash
# Gate for a built runtime image (SP1.6 F11): run before pushing to GHCR (ci.yml `images` job) and
# locally after `docker build`. Usage: infra/docker/verify-image.sh <image> <api|worker|web>
# Asserts: non-root (uid 1001), no build tooling in any node_modules, no sources under apps/ or
# packages/, the workspace packages resolve from the app (api/worker), the Prisma CLI is present
# (api: `nibras-entrypoint migrate`), the standalone server exists (web), and a size ceiling.
set -euo pipefail

image="${1:?usage: verify-image.sh <image> <api|worker|web>}"
app="${2:?usage: verify-image.sh <image> <api|worker|web>}"
case "$app" in
  api | worker | web) ;;
  *)
    echo "verify-image: unknown app '$app' (api, worker or web)" >&2
    exit 2
    ;;
esac

# api/worker ceiling; generous on purpose, tighten once CI has recorded a few sizes.
MAX_BYTES=$((600 * 1024 * 1024))

failures=0
check() {
  local label="$1"
  shift
  if "$@"; then
    echo "ok   $label"
  else
    echo "FAIL $label" >&2
    failures=$((failures + 1))
  fi
}

# Runs a shell snippet inside the image (entrypoint bypassed, default user kept).
in_image() {
  docker run --rm --network none --entrypoint sh "$image" -c "$1"
}

check "runs as uid 1001" test "$(in_image 'id -u')" = "1001"

tooling=$(in_image "find / \\( -path /proc -o -path /sys \\) -prune -o \\( \
  -path '*/node_modules/typescript' -o -path '*/node_modules/vitest' -o \
  -path '*/node_modules/eslint' -o -path '*/node_modules/@nestjs/cli' -o \
  -path '*/node_modules/@swc/core' \\) -print 2>/dev/null; true")
if [ -n "$tooling" ]; then
  echo "$tooling" | head -n 20 >&2 || true
fi
check "no typescript/vitest/eslint/@nestjs/cli/@swc/core in node_modules" test -z "$tooling"

sources=$(in_image "find /app/apps /app/packages -name node_modules -prune -o -type d -name src -print 2>/dev/null; true")
if [ -n "$sources" ]; then
  echo "$sources" | head -n 20 >&2 || true
fi
check "no src/ under apps/ or packages/" test -z "$sources"

case "$app" in
  api | worker)
    check "@nibras/db, contracts, providers resolve from apps/$app" \
      in_image "cd /app/apps/$app && node -e \"require('@nibras/db'); require('@nibras/contracts'); require('@nibras/providers')\""
    ;;
  web)
    check "standalone server present" in_image "test -f /app/apps/web/server.js"
    ;;
esac

if [ "$app" = "api" ]; then
  check "prisma CLI present (nibras-entrypoint migrate)" \
    in_image "test -f /app/packages/db/node_modules/prisma/build/index.js"
fi

size=$(docker image inspect --format '{{.Size}}' "$image")
echo "size $image: $((size / 1024 / 1024)) MB"
if [ "$app" != "web" ]; then
  check "size <= $((MAX_BYTES / 1024 / 1024)) MB" test "$size" -le "$MAX_BYTES"
fi

if [ "$failures" -gt 0 ]; then
  echo "verify-image: $failures check(s) failed for $image" >&2
  exit 1
fi
echo "verify-image: $image ($app) passed"
