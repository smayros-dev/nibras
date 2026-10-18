# Staging

Staging runs the three container images built by CI (`ghcr.io/<owner>/nibras-{web,api,worker}`) with
Postgres, Redis and MinIO on a single Docker host, described by `infra/compose.staging.yml`.

## Pipeline

1. A push to `main` runs **CI** (`.github/workflows/ci.yml`): `check`, `windows-check`,
   `migrate-check` and `e2e`; when all four pass, `images` builds and pushes
   `nibras-{web,api,worker}:<commit sha>` and `:latest` to GHCR. Pull requests never build images.
2. **Deploy staging** (`.github/workflows/deploy-staging.yml`) runs when CI completes successfully on
   `main`. It copies `infra/compose.staging.yml` and `infra/docker/postgres/init-staging.sh` to the
   host over SSH, then runs `docker compose pull` and `up -d` with `NIBRAS_IMAGE_TAG=<commit sha>`.
   The api's `migrate` one-shot service applies migrations before the api and worker start.

The deploy job is **off** until the repository variable `STAGING_DEPLOY_ENABLED` is `true`, and it is
skipped (with a notice, not a failure) while the SSH secrets below are missing.

## GitHub configuration

Settings > Secrets and variables > Actions (or the `staging` environment):

| Name                     | Kind     | Value                                                                     |
| ------------------------ | -------- | ------------------------------------------------------------------------- |
| `STAGING_SSH_HOST`       | secret   | Host name or IP of the staging server                                     |
| `STAGING_SSH_USER`       | secret   | Deploy user on that host (member of the `docker` group, no sudo needed)   |
| `STAGING_SSH_KEY`        | secret   | Private key (ed25519) whose public key is in the user's `authorized_keys` |
| `GHCR_READ_USER`         | secret   | GitHub user owning the token below                                        |
| `GHCR_READ_TOKEN`        | secret   | Classic PAT with `read:packages` only (pulls private images on the host)  |
| `STAGING_DEPLOY_ENABLED` | variable | `true` to turn deploys on                                                 |
| `STAGING_DIR`            | variable | Optional; deploy directory on the host (default `/opt/nibras`)            |

CI pushes images with the workflow's own `GITHUB_TOKEN` (`packages: write`, `images` job only);
no extra secret is needed for that. If the GHCR packages are public, `GHCR_READ_*` can be omitted.

## Host prerequisites

- Linux VM in the **EU (Paris) region** (D-P4), e.g. 2 vCPU / 4 GB RAM / 40 GB disk.
- Docker Engine 24+ with the Compose v2 plugin; the deploy user in the `docker` group.
- Firewall: SSH from GitHub Actions runners (or a bastion) and HTTPS from the internet; Postgres,
  Redis and MinIO publish **no** ports.
- A TLS reverse proxy (Caddy, nginx, Traefik) in front of `127.0.0.1:3000` (the web container).
  The browser reaches the API through the web app's `/api/*` rewrite, so only the web is exposed.
- `<STAGING_DIR>/infra/.env.staging` (mode `600`, owned by the deploy user) holding the real secrets.
  It is never committed and never baked into an image.

### `.env.staging`

Start from `.env.example`; hosts are the compose service names, every password is a fresh random
value (`openssl rand -hex 24`):

```dotenv
NODE_ENV=production
LOG_LEVEL=info
NIBRAS_IMAGE_OWNER=<github owner, lowercase>

POSTGRES_PASSWORD=<random>
APP_SYSTEM_DB_PASSWORD=<random>
APP_USER_DB_PASSWORD=<random>
DATABASE_URL=postgresql://app_user:<APP_USER_DB_PASSWORD>@postgres:5432/nibras
DATABASE_URL_SYSTEM=postgresql://app_system:<APP_SYSTEM_DB_PASSWORD>@postgres:5432/nibras

REDIS_URL=redis://redis:6379

WEB_ORIGIN=https://staging.example.com
API_URL=http://api:3001
# See "Client IP behind the proxies" below; compose.staging.yml defaults it to 1.
TRUST_PROXY_HOPS=1
OTEL_EXPORTER_OTLP_ENDPOINT=

SMTP_URL=smtp://<user>:<password>@<smtp relay>:587
EMAIL_FROM="Nibras <no-reply@staging.example.com>"

# Auth (SP1): fresh values per environment, never the .env.example ones.
JWT_SECRET=<openssl rand -base64 48>
TOTP_ENCRYPTION_KEY=<openssl rand -base64 32>
HIBP_ENABLED=true
COOKIE_SECURE=true

S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<random>
S3_SECRET_KEY=<random>
S3_BUCKET=nibras-staging
```

The API validates these at startup and refuses to boot when one is missing or malformed:
`TOTP_ENCRYPTION_KEY` must be canonical base64 of exactly 32 bytes and `REDIS_URL` must use
`redis:` or `rediss:`.

**Startup refusals outside development.** With `APP_ENV=staging` or `production` the API and the
worker also refuse to start (exit 1, the error names every offending variable) when:

- `JWT_SECRET` or `TOTP_ENCRYPTION_KEY` is a value committed to the repository (`.env.example`,
  CI, test fixtures), starts with `dev-only`, `ci-only` or `test-only`, or contains `change-me`
  (API only; the worker has neither);
- `JWT_SECRET` uses fewer than 3 character classes (lowercase, uppercase, digit, other) — use
  `openssl rand -base64 48`, not `-hex`;
- `DATABASE_URL` (API) or `DATABASE_URL_SYSTEM` (API and worker) uses the password `app` of the
  local `init.sql`;
- `COOKIE_SECURE` is not `true` (API; when omitted it defaults to `true` because the images run
  `NODE_ENV=production`);
- `WEB_ORIGIN` is not an `https:` URL (API and worker).

`HIBP_ENABLED` is not checked: it stays a free choice in every tier (`true` recommended above).
Local development (`APP_ENV=development` or unset), the test suites and CI (`APP_ENV: development`
in `ci.yml`, also forced by the Playwright web servers) keep accepting the placeholder values. `compose.staging.yml` sets `APP_ENV=staging` for the api, the worker and the web
(images run with `NODE_ENV=production` and default to `APP_ENV=production`; `APP_ENV` is the
deployment tier, pinned per service so the `development` copied from `.env.example` never applies:
it would enable the e2e TERMS override), so staging may use
`SMS_PROVIDER=console` (the log provider: nothing is sent). `APP_ENV=production` refuses `console`: production needs a real SMS provider, which is
still an owner decision.

`PORT` and `WORKER_PORT` are left out on purpose: every app service reads this one file, so
`compose.staging.yml` pins them per service (api `3001`, web `3000`, worker `3002`) and any value
set here is ignored.

`API_URL` is also baked into the web image's `/api/*` rewrite at build time (default
`http://api:3001`, matching the compose service name).

## Client IP behind the proxies

The API derives the client address (`req.ip`: request context, SP1 rate limits and audit) from
`X-Forwarded-For`, trusting `TRUST_PROXY_HOPS` hops (Express `trust proxy`; an integer >= 0,
default 1). Express trusts its socket peer plus `TRUST_PROXY_HOPS - 1` entries from the right of
`X-Forwarded-For` and takes the next one as the client.

On staging the path is browser -> host TLS proxy -> `web` (Next.js) -> `api`:

- the TLS proxy appends the client address to `X-Forwarded-For` (nginx
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`; Caddy and Traefik by default);
- `web` forwards the header **unchanged**: the Next.js `/api/*` rewrite proxy does not append its
  peer (checked in Next 16: `httpxy` runs without `xfwd`), and `serverApi()`
  (`apps/web/src/lib/api.ts`) forwards the incoming value as received.

So the API's peer is `web` (hop 1) and the rightmost header entry is the one the TLS proxy wrote:
**staging uses `TRUST_PROXY_HOPS=1`** (default in `compose.staging.yml`; `.env.staging` may
override it). Do not set 2 for this topology: the API would take the entry to the _left_ of the
TLS proxy's, which the client controls (a spoofable address). Use 2 only when a second proxy that
appends to the header (e.g. a cloud load balancer in front of the TLS proxy) is added.

- **`WEB_BIND=0.0.0.0` caveat.** Exposing `web` directly (binding it on all interfaces instead of
  behind the TLS proxy) removes the TLS proxy hop: with `TRUST_PROXY_HOPS=1` the API then believes
  whatever `X-Forwarded-For` the browser sends. Set `TRUST_PROXY_HOPS=0` in that topology and accept
  that `req.ip` is then the `web` container (rate limits and audit see one address).
- **Overwrite-XFF proxies.** A proxy configured to _replace_ the header (nginx
  `proxy_set_header X-Forwarded-For $remote_addr`) makes hop counting moot: the header holds only
  the client address it saw, so keep `1`. Never combine `$proxy_add_x_forwarded_for` (appending)
  with a hop count larger than the number of appending proxies: the extra hop is client-controlled.

## First run

```bash
sudo mkdir -p /opt/nibras/infra/docker/postgres && sudo chown -R deploy:deploy /opt/nibras
# copy infra/compose.staging.yml and infra/docker/postgres/init-staging.sh from the repo
# (the deploy workflow does this on every run), then write /opt/nibras/infra/.env.staging
cd /opt/nibras/infra
chmod 600 .env.staging
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <GHCR_READ_USER> --password-stdin
docker compose --env-file .env.staging -f compose.staging.yml pull
docker compose --env-file .env.staging -f compose.staging.yml up -d
docker compose --env-file .env.staging -f compose.staging.yml ps     # all healthy, migrate exited 0
curl -fsS http://127.0.0.1:3000/health/live
```

On the empty volume Postgres runs `init-staging.sh` once: roles `app_system` / `app_user` with the
passwords from `.env.staging` and the `nibras` database. Changing those passwords later means
`ALTER ROLE ... PASSWORD` in Postgres **and** updating `.env.staging`.
Create the MinIO bucket once: `docker compose ... exec minio mc mb --ignore-existing local/nibras-staging`
(after `mc alias set local http://localhost:9000 $S3_ACCESS_KEY $S3_SECRET_KEY`).

### Hosts set up before the rename to Nibras

The project was first called TT. A staging host deployed before the rename keeps working once these
are applied by hand (the repo cannot do them):

- `.env.staging`: rename `TT_IMAGE_OWNER` / `TT_IMAGE_TAG` to `NIBRAS_IMAGE_OWNER` / `NIBRAS_IMAGE_TAG`.
  The database stays `tt` on the existing volume (`init-staging.sh` never re-runs), so either keep
  `DATABASE_URL*` pointing at `/tt` or run `ALTER DATABASE tt RENAME TO nibras;` (no open
  connections: stop api/worker first) and update both URLs. Same for `S3_BUCKET`: keep the existing
  bucket name or create the new bucket and copy the objects.
- The compose project is now `nibras-staging`; its volumes are pinned to their old
  `tt-staging_*` names in `compose.staging.yml`, so the data is kept. Before the first deploy, stop
  the old project (`docker compose -p tt-staging -f compose.staging.yml down`, **without** `-v`).
- The images are now `ghcr.io/<owner>/nibras-{web,api,worker}` (the old `tt-*` packages stay in GHCR
  until deleted). Either keep `/opt/tt` by setting the `STAGING_DIR` variable to it, or move the
  directory to the new default `/opt/nibras`.
- Every user is signed out once (the session cookies are now `nibras_access` / `nibras_refresh`).

## Running migrations manually

Migrations never run on api boot; only the `migrate` one-shot (api image, `migrate` argument) runs
`prisma migrate deploy` as `app_system`:

```bash
cd /opt/nibras/infra
docker compose --env-file .env.staging -f compose.staging.yml run --rm migrate
```

Same thing with plain Docker: `docker run --rm --env-file .env.staging --network nibras-staging_default ghcr.io/<owner>/nibras-api:<tag> migrate`.

## Rollback

Every deploy appends `<UTC time> <sha>` to `/opt/nibras/infra/deployed-tags.log`. To roll back, start
the previous tag:

```bash
cd /opt/nibras/infra
NIBRAS_IMAGE_TAG=<previous sha> docker compose --env-file .env.staging -f compose.staging.yml up -d
```

Alternatively re-tag the previous image as `latest` (`docker tag ghcr.io/<owner>/nibras-api:<sha> ghcr.io/<owner>/nibras-api:latest`
for each app) and `up -d` without `NIBRAS_IMAGE_TAG`. Prisma migrations are forward-only: a rollback across
a migration needs a new forward migration (or a restore), not an older image alone.

## Health

`/health/live` and `/health/ready` on each app; every image has a Docker `HEALTHCHECK` on
`/health/live`. `docker compose ... ps` shows the health state; `docker compose ... logs -f api`
streams the JSON logs.
