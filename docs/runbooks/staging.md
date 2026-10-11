# Staging

Staging runs the three container images built by CI (`ghcr.io/<owner>/tt-{web,api,worker}`) with
Postgres, Redis and MinIO on a single Docker host, described by `infra/compose.staging.yml`.

## Pipeline

1. A push to `main` runs **CI** (`.github/workflows/ci.yml`): `check`, `windows-check`,
   `migrate-check` and `e2e`; when all four pass, `images` builds and pushes
   `tt-{web,api,worker}:<commit sha>` and `:latest` to GHCR. Pull requests never build images.
2. **Deploy staging** (`.github/workflows/deploy-staging.yml`) runs when CI completes successfully on
   `main`. It copies `infra/compose.staging.yml` and `infra/docker/postgres/init-staging.sh` to the
   host over SSH, then runs `docker compose pull` and `up -d` with `TT_IMAGE_TAG=<commit sha>`.
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
| `STAGING_DIR`            | variable | Optional; deploy directory on the host (default `/opt/tt`)                |

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
TT_IMAGE_OWNER=<github owner, lowercase>

POSTGRES_PASSWORD=<random>
APP_SYSTEM_DB_PASSWORD=<random>
APP_USER_DB_PASSWORD=<random>
DATABASE_URL=postgresql://app_user:<APP_USER_DB_PASSWORD>@postgres:5432/tt
DATABASE_URL_SYSTEM=postgresql://app_system:<APP_SYSTEM_DB_PASSWORD>@postgres:5432/tt

REDIS_URL=redis://redis:6379

WEB_ORIGIN=https://staging.example.com
API_URL=http://api:3001
# See "Client IP behind the proxies" below; compose.staging.yml defaults it to 1.
TRUST_PROXY_HOPS=1
OTEL_EXPORTER_OTLP_ENDPOINT=

SMTP_URL=smtp://<user>:<password>@<smtp relay>:587
EMAIL_FROM="TT <no-reply@staging.example.com>"

# Auth (SP1): fresh values per environment, never the .env.example ones.
JWT_SECRET=<openssl rand -base64 48>
TOTP_ENCRYPTION_KEY=<openssl rand -base64 32>
HIBP_ENABLED=true
COOKIE_SECURE=true

S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<random>
S3_SECRET_KEY=<random>
S3_BUCKET=tt-staging
```

The API validates these at startup and refuses to boot when one is missing or malformed:
`TOTP_ENCRYPTION_KEY` must be canonical base64 of exactly 32 bytes, `REDIS_URL` must use `redis:`
or `rediss:`, and `SMS_PROVIDER=console` (the only provider so far, which logs instead of sending)
is rejected when `NODE_ENV=production` — staging needs a real SMS provider before it can run SP1.

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
sudo mkdir -p /opt/tt/infra/docker/postgres && sudo chown -R deploy:deploy /opt/tt
# copy infra/compose.staging.yml and infra/docker/postgres/init-staging.sh from the repo
# (the deploy workflow does this on every run), then write /opt/tt/infra/.env.staging
cd /opt/tt/infra
chmod 600 .env.staging
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <GHCR_READ_USER> --password-stdin
docker compose --env-file .env.staging -f compose.staging.yml pull
docker compose --env-file .env.staging -f compose.staging.yml up -d
docker compose --env-file .env.staging -f compose.staging.yml ps     # all healthy, migrate exited 0
curl -fsS http://127.0.0.1:3000/health/live
```

On the empty volume Postgres runs `init-staging.sh` once: roles `app_system` / `app_user` with the
passwords from `.env.staging` and the `tt` database. Changing those passwords later means
`ALTER ROLE ... PASSWORD` in Postgres **and** updating `.env.staging`.
Create the MinIO bucket once: `docker compose ... exec minio mc mb --ignore-existing local/tt-staging`
(after `mc alias set local http://localhost:9000 $S3_ACCESS_KEY $S3_SECRET_KEY`).

## Running migrations manually

Migrations never run on api boot; only the `migrate` one-shot (api image, `migrate` argument) runs
`prisma migrate deploy` as `app_system`:

```bash
cd /opt/tt/infra
docker compose --env-file .env.staging -f compose.staging.yml run --rm migrate
```

Same thing with plain Docker: `docker run --rm --env-file .env.staging --network tt-staging_default ghcr.io/<owner>/tt-api:<tag> migrate`.

## Rollback

Every deploy appends `<UTC time> <sha>` to `/opt/tt/infra/deployed-tags.log`. To roll back, start
the previous tag:

```bash
cd /opt/tt/infra
TT_IMAGE_TAG=<previous sha> docker compose --env-file .env.staging -f compose.staging.yml up -d
```

Alternatively re-tag the previous image as `latest` (`docker tag ghcr.io/<owner>/tt-api:<sha> ghcr.io/<owner>/tt-api:latest`
for each app) and `up -d` without `TT_IMAGE_TAG`. Prisma migrations are forward-only: a rollback across
a migration needs a new forward migration (or a restore), not an older image alone.

## Health

`/health/live` and `/health/ready` on each app; every image has a Docker `HEALTHCHECK` on
`/health/live`. `docker compose ... ps` shows the health state; `docker compose ... logs -f api`
streams the JSON logs.
