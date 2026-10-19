# Staging

Staging runs the three container images built by CI (`ghcr.io/<owner>/nibras-{web,api,worker}`) with
Postgres, Redis and MinIO on a single Docker host, described by `infra/compose.staging.yml`. Staging runs on a local machine today; the production
target is OVHcloud, with the same procedures. Security rules (per-service environment, image gate,
host-key pinning, GitHub settings to enable): [security.md](security.md).

## Pipeline

1. A push to `main` runs **CI** (`.github/workflows/ci.yml`): `check`, `windows-check`,
   `migrate-check` and `e2e`; when all four pass, `images` builds and pushes
   `nibras-{web,api,worker}:<commit sha>` and `:latest` to GHCR. Pull requests never build images.
2. **Deploy staging** (`.github/workflows/deploy-staging.yml`) runs when CI completes successfully on
   `main`. It copies `infra/compose.staging.yml` and `infra/docker/postgres/init-staging.sh` to the
   host over SSH, then runs `docker compose pull` and `up -d` with `NIBRAS_IMAGE_TAG=<commit sha>`.
   The api's `migrate` one-shot service applies migrations before the api and worker start.

The deploy job is **off** until the repository variable `STAGING_DEPLOY_ENABLED` is `true`, and it is
skipped (with a notice naming each missing secret, not a failure) while any of the four SSH secrets
below is missing — `STAGING_SSH_FINGERPRINT` included: the job never deploys without a pinned host
key.

## GitHub configuration

Settings > Secrets and variables > Actions (or the `staging` environment):

| Name                      | Kind     | Value                                                                                                                                                        |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STAGING_SSH_HOST`        | secret   | Host name or IP of the staging server                                                                                                                        |
| `STAGING_SSH_USER`        | secret   | Deploy user on that host (member of the `docker` group, no sudo needed)                                                                                      |
| `STAGING_SSH_KEY`         | secret   | Private key (ed25519) whose public key is in the user's `authorized_keys`                                                                                    |
| `STAGING_SSH_FINGERPRINT` | secret   | Optional for now: SHA256 fingerprint of the host's ed25519 key (below). While absent the deploy job skips with a notice; add it before the first real deploy |
| `GHCR_READ_USER`          | secret   | GitHub user owning the token below                                                                                                                           |
| `GHCR_READ_TOKEN`         | secret   | Classic PAT with `read:packages` only (pulls private images on the host)                                                                                     |
| `STAGING_DEPLOY_ENABLED`  | variable | `true` to turn deploys on                                                                                                                                    |
| `STAGING_DIR`             | variable | Optional; deploy directory on the host (default `/opt/nibras`)                                                                                               |

CI pushes images with the workflow's own `GITHUB_TOKEN` (`packages: write`, `images` job only);
no extra secret is needed for that. If the GHCR packages are public, `GHCR_READ_*` can be omitted.

### Host-key fingerprint (`STAGING_SSH_FINGERPRINT`)

Both SSH steps (`appleboy/scp-action`, `appleboy/ssh-action`) verify the server's host key against
this value, so a hijacked `STAGING_SSH_HOST` (DNS, routing) never receives the deploy key's
authentication, the compose file or the GHCR token (SP1.6 F4). Obtain it once, from a trusted
network (ideally on the host itself: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), and
compare both outputs:

```sh
ssh-keyscan -t ed25519 "$STAGING_SSH_HOST" | ssh-keygen -lf -
# 256 SHA256:AbCd…xyz staging.example (ED25519)
```

The secret is the `SHA256:…` field (with the `SHA256:` prefix). Re-run it after the host key is
regenerated (new VM, reinstall): until the secret is updated, the deploy fails on the key mismatch.
The procedure is identical for today's local staging machine and for the OVHcloud production target.

### Updating actions

Every `uses:` in `.github/workflows/*.yml` is pinned to a full commit SHA with the release as a
trailing comment (`uses: actions/checkout@<40-hex> # v5.1.0`); `packages/config/infra/workflows.test.ts`
fails on a tag or branch reference. Dependabot (`.github/dependabot.yml`) opens a weekly PR that
bumps both the SHA and the comment for GitHub Actions, npm (minor/patch grouped; majors of `next`,
`@nestjs/*`, `prisma`, `@prisma/client` are ignored — planned upgrades) and the `infra/docker`
base images. To pin a new action by hand, resolve the tag to its commit, never copy a SHA from
elsewhere:

```sh
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type + " " + .object.sha'
# an annotated tag ("tag <sha>") needs one more call for the commit:
gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha
```

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

The file is used **for compose interpolation only** (`docker compose --env-file .env.staging`): no
container reads it whole. Each service receives only the variables listed for it in
`compose.staging.yml` (table below), so the published `web` container holds no secret, the `api`
never sees the BYPASSRLS `DATABASE_URL_SYSTEM`, and the `worker` never sees the auth secrets (SP1.6
F3). A variable set here but not in the table reaches no container.

Start from `.env.example`; hosts are the compose service names, every password is a fresh random
value (`openssl rand -hex 24`):

```dotenv
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

# MinIO root credentials (no app service receives S3_* yet).
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<random>
S3_SECRET_KEY=<random>
S3_BUCKET=nibras-staging
```

**Which service receives what.** Kept in step with `compose.staging.yml` by
`packages/config/infra/compose-staging.test.ts` (every `${VAR}` of the compose file must have a row
here naming exactly the services that use it):

| Variable                      | Used by                   | Required / default                                         |
| ----------------------------- | ------------------------- | ---------------------------------------------------------- |
| `NIBRAS_IMAGE_OWNER`          | api, migrate, web, worker | required (image path only, not passed into the containers) |
| `NIBRAS_IMAGE_TAG`            | api, migrate, web, worker | default `latest` (the deploy job sets the commit SHA)      |
| `POSTGRES_PASSWORD`           | postgres                  | required                                                   |
| `APP_SYSTEM_DB_PASSWORD`      | postgres                  | required (init script, first boot only)                    |
| `APP_USER_DB_PASSWORD`        | postgres                  | required (init script, first boot only)                    |
| `S3_ACCESS_KEY`               | minio                     | required (MinIO root user)                                 |
| `S3_SECRET_KEY`               | minio                     | required (MinIO root password)                             |
| `DATABASE_URL_SYSTEM`         | migrate, worker           | required (`app_system`, BYPASSRLS)                         |
| `DATABASE_URL`                | api                       | required (`app_user`, RLS enforced)                        |
| `REDIS_URL`                   | api, worker               | required                                                   |
| `WEB_ORIGIN`                  | api, worker               | required                                                   |
| `SMTP_URL`                    | api, worker               | required                                                   |
| `EMAIL_FROM`                  | api, worker               | required                                                   |
| `JWT_SECRET`                  | api                       | required                                                   |
| `TOTP_ENCRYPTION_KEY`         | api                       | required                                                   |
| `SMS_PROVIDER`                | api                       | default `console`                                          |
| `HIBP_ENABLED`                | api                       | default `true`                                             |
| `COOKIE_SECURE`               | api                       | default `true`                                             |
| `RATE_LIMIT_USER`             | api                       | default `600`                                              |
| `RATE_LIMIT_ANON`             | api                       | default `60`                                               |
| `TRUST_PROXY_HOPS`            | api                       | default `1` (see "Client IP behind the proxies")           |
| `LOG_LEVEL`                   | api, worker               | default `info`                                             |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | api                       | default empty (tracing off)                                |
| `API_URL`                     | web                       | default `http://api:3001`                                  |
| `WEB_BIND`                    | web                       | default `127.0.0.1` (host port binding, not passed in)     |

A required variable that is missing or empty stops `docker compose` before any container starts
(`required variable JWT_SECRET is missing a value: set JWT_SECRET in .env.staging`).
`NODE_ENV=production`, `APP_ENV=staging` and the listen ports (api `PORT=3001`, web `PORT=3000`,
worker `WORKER_PORT=3002`) are fixed in `compose.staging.yml`, not read from this file.

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
- `DATABASE_URL` (API) or `DATABASE_URL_SYSTEM` (worker; the API checks it only when set — it is
  optional there and never given to the api service) uses the password `app` of the local
  `init.sql`;
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

**Read-only containers.** `migrate`, `api`, `worker` and `web` run with `read_only: true`,
`cap_drop: [ALL]`, `no-new-privileges` and `init: true` (an init process reaps zombies and forwards
signals). `/tmp` is a tmpfs in each (wiped on restart), and the web also gets a tmpfs on
`/app/apps/web/.next/cache` (Next's runtime fetch/image cache). An `EROFS: read-only file system`
in the logs means a new write path: add a tmpfs for it in `compose.staging.yml`, never drop
`read_only`. Postgres, Redis and MinIO are unchanged (they write to their volumes).

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

Same thing with plain Docker (only `DATABASE_URL_SYSTEM` goes into the container, never the whole file):

```bash
DATABASE_URL_SYSTEM="$(sed -n 's/^DATABASE_URL_SYSTEM=//p' .env.staging)"   docker run --rm --read-only --tmpfs /tmp -e DATABASE_URL_SYSTEM   --network nibras-staging_default ghcr.io/<owner>/nibras-api:<tag> migrate
```

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
