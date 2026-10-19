/**
 * Startup refusals for deployable tiers (`APP_ENV` staging|production): the placeholder secrets
 * shipped in the repository (`.env.example`, CI, test fixtures), the `init.sql` database password,
 * insecure cookies and plain-http origins. Shared by the API and the worker; pure and zod-free.
 * Not exported from the `web` entry (browser bundles have no use for it).
 */

/** Password of `app_user` / `app_system` in `infra/docker/postgres/init.sql` (local dev, CI). */
export const INIT_SQL_DB_PASSWORD = 'app';

/** Every secret value committed to the repository. Never valid outside development. */
export const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  // .env.example
  'dev-only-jwt-secret-change-me-0123456789abcdef',
  'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
  // .github/workflows/ci.yml
  'ci-only-jwt-secret-not-a-real-secret-0123456789',
  'Y2ktb25seS10b3RwLWtleS0zMi1ieXRlcy1sb25nISE=',
  // test fixtures (base64 of 'test-only-totp-key-32-bytes-long')
  'test-only-jwt-secret-0123456789abcdef',
  'dGVzdC1vbmx5LXRvdHAta2V5LTMyLWJ5dGVzLWxvbmc=',
]);

const PLACEHOLDER_PATTERN = /^(dev|ci|test)-only|change-me/i;

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim();
  return PLACEHOLDER_SECRETS.has(v) || PLACEHOLDER_PATTERN.test(v);
}

/** Fewer than 3 of lowercase / uppercase / digit / other, or one character repeated. */
export function hasWeakEntropy(secret: string): boolean {
  if (/^(.)\1*$/s.test(secret)) return true;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(secret));
  return classes.length < 3;
}

/** Decoded password of a connection URL (`''` when it has none), `null` when not a URL. */
export function dbPasswordOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const { password } = new URL(url);
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
}

/** The variables checked; `undefined` = the service does not have it (the worker: no JWT, …). */
export interface DeployableEnvInput {
  APP_ENV: string;
  JWT_SECRET?: string;
  TOTP_ENCRYPTION_KEY?: string;
  DATABASE_URL?: string;
  DATABASE_URL_SYSTEM?: string;
  COOKIE_SECURE?: boolean;
  WEB_ORIGIN?: string;
}

/**
 * Reports one issue per offending variable when `APP_ENV` is not `development`. `HIBP_ENABLED`
 * is deliberately not checked: it stays a free choice in every tier (owner, SP1.6 Q2).
 */
export function assertDeployableEnv(
  e: DeployableEnvInput,
  issue: (path: string, message: string) => void,
): void {
  if (e.APP_ENV === 'development') return;
  const tier = `APP_ENV=${e.APP_ENV}`;
  const placeholder = (name: string, generate: string) =>
    issue(name, `${name} is a development placeholder: generate a real value (${generate})`);

  if (e.JWT_SECRET !== undefined) {
    if (isPlaceholderSecret(e.JWT_SECRET)) placeholder('JWT_SECRET', 'openssl rand -base64 48');
    else if (hasWeakEntropy(e.JWT_SECRET)) {
      issue(
        'JWT_SECRET',
        `JWT_SECRET is too weak (fewer than 3 character classes): generate a real value (openssl rand -base64 48)`,
      );
    }
  }
  if (e.TOTP_ENCRYPTION_KEY !== undefined && isPlaceholderSecret(e.TOTP_ENCRYPTION_KEY)) {
    placeholder('TOTP_ENCRYPTION_KEY', 'openssl rand -base64 32');
  }
  for (const name of ['DATABASE_URL', 'DATABASE_URL_SYSTEM'] as const) {
    const url = e[name];
    if (url !== undefined && dbPasswordOf(url) === INIT_SQL_DB_PASSWORD) {
      issue(
        name,
        `${name} uses the development database password '${INIT_SQL_DB_PASSWORD}' (init.sql): set a real password (openssl rand -hex 24)`,
      );
    }
  }
  if (e.COOKIE_SECURE !== undefined && e.COOKIE_SECURE !== true) {
    issue('COOKIE_SECURE', `COOKIE_SECURE must be true when ${tier}`);
  }
  if (
    e.WEB_ORIGIN !== undefined &&
    (!URL.canParse(e.WEB_ORIGIN) || new URL(e.WEB_ORIGIN).protocol !== 'https:')
  ) {
    issue('WEB_ORIGIN', `WEB_ORIGIN must use https: when ${tier}`);
  }
}
