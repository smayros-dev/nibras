import { assertDeployableEnv } from '@nibras/contracts';
import { z } from 'zod';

/** Empty strings in `.env` (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT=`) mean "unset". */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());
/** S3 endpoints: http(s) only (`minio:9000` parses as a URL with the scheme `minio:`). */
const httpUrl = () => z.url({ protocol: /^https?$/ });
const optionalHttpUrl = z.preprocess((v) => (v === '' ? undefined : v), httpUrl().optional());
/** Same for strings: compose passes optional variables as `${VAR:-}` (empty). */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

/** Every value `VIDEO_PROVIDER=cloudflare_stream` needs in the API (tus upload, JWT, webhooks). */
export const CLOUDFLARE_API_VARS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
  'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
  'CLOUDFLARE_STREAM_SIGNING_KEY_ID',
  'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
  'CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN',
] as const;

const TOTP_KEY_BYTES = 32;

/**
 * Canonical base64 of exactly 32 bytes. `Buffer.from(v, 'base64')` silently skips invalid
 * characters and accepts missing padding or the base64url alphabet, so the value must also
 * round-trip to itself: a typo can never yield a different (shorter or garbled) key.
 */
function isTotpKey(value: string): boolean {
  const key = Buffer.from(value, 'base64');
  return key.length === TOTP_KEY_BYTES && key.toString('base64') === value.trim();
}

const EnvObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Deployment tier. Independent of `NODE_ENV`, which is `production` in every built image
   * (staging included): production-only guards key off this.
   */
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** `app_user` role: RLS enforced (PRD §13.3). */
  DATABASE_URL: z.url(),
  /**
   * `app_system` role: BYPASSRLS, never used for request handling. Tests and the CLI only
   * (`systemPrisma()`); never set on the api service (SP1.6 F3, `infra/compose.staging.yml`).
   */
  DATABASE_URL_SYSTEM: z.url().optional(),
  // `URL.canParse` first: zod still runs refinements after `z.url()` fails, and `new URL` throws.
  REDIS_URL: z
    .url()
    .refine(
      (u) => URL.canParse(u) && /^rediss?:$/.test(new URL(u).protocol),
      'REDIS_URL must use redis: or rediss:',
    ),
  /** The only origin CORS accepts (credentials allowed). */
  WEB_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  /**
   * Reverse-proxy hops in front of the API whose `X-Forwarded-For` entries are trusted (Express
   * `trust proxy`), so `req.ip` is the client: 1 locally and on staging (the Next.js server is the
   * only hop that terminates on the API; the TLS proxy's entry is the rightmost), 2 only when a
   * second appending proxy is added — see docs/runbooks/staging.md. 0 trusts none.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  /** HS256 signing key of the access JWT. */
  JWT_SECRET: z.string().min(32),
  /** AES-256-GCM key sealing TOTP seeds at rest (`SecretBox`): base64 of 32 bytes. */
  TOTP_ENCRYPTION_KEY: z
    .string()
    .refine(isTotpKey, 'TOTP_ENCRYPTION_KEY must be canonical base64 of exactly 32 bytes'),
  SMTP_URL: z.url(),
  /** RFC 5322 sender, e.g. `Nibras <no-reply@example.com>`. */
  EMAIL_FROM: z.string().min(3),
  /** `console` = `LogSmsProvider` (logs, sends nothing): development and CI only. */
  SMS_PROVIDER: z.enum(['console']).default('console'),
  /** Have I Been Pwned range lookups on password set/change (network call). */
  HIBP_ENABLED: z.stringbool().default(true),
  /** `Secure` flag of the auth cookies; defaults to `NODE_ENV === 'production'`. */
  COOKIE_SECURE: z.stringbool().optional(),
  /** Requests per minute per authenticated user (global throttle). */
  RATE_LIMIT_USER: z.coerce.number().int().min(1).default(600),
  /** Requests per minute per anonymous ip (public routes, login, register, …). */
  RATE_LIMIT_ANON: z.coerce.number().int().min(1).default(60),
  // SP3 object storage (MinIO locally/CI, OVH Object Storage in production).
  /** Endpoint the API reaches (e.g. `http://minio:9000`). */
  S3_ENDPOINT: httpUrl(),
  /** Endpoint browsers reach, used for presigned URLs only; empty = `S3_ENDPOINT`. */
  S3_PUBLIC_ENDPOINT: optionalHttpUrl,
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().regex(/^[a-z0-9.-]{3,63}$/, 'S3_BUCKET must be a valid S3 bucket name'),
  /** Path-style URLs (`http://host/bucket/key`): true for MinIO. */
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  /** `s3` = passthrough in the bucket above (dev/CI/staging); `cloudflare_stream` (D-P1). */
  VIDEO_PROVIDER: z.enum(['s3', 'cloudflare_stream']).default('s3'),
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_STREAM_API_TOKEN: optionalString,
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: optionalString,
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: optionalString,
  /** PEM (PKCS#1 or PKCS#8), or the base64 of it as `POST /stream/keys` returns it. */
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: optionalString,
  /** `customer-<code>.cloudflarestream.com`. */
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: optionalString,
});

// Defaults first, so the rules see the effective values: a staging env that omits COOKIE_SECURE
// gets `true` from NODE_ENV=production (every image) and passes.
export const EnvSchema = EnvObject.transform((e) => ({
  ...e,
  COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
})).superRefine((e, ctx) => {
  // The log provider never delivers a code: production would lock every teacher out of phone
  // verification without anyone noticing. Staging (APP_ENV=staging) may use it.
  if (e.APP_ENV === 'production' && e.SMS_PROVIDER === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMS_PROVIDER'],
      message: 'SMS_PROVIDER=console (log only) is not allowed when APP_ENV=production',
    });
  }
  if (e.VIDEO_PROVIDER === 'cloudflare_stream') {
    for (const name of CLOUDFLARE_API_VARS) {
      if (!e[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when VIDEO_PROVIDER=cloudflare_stream`,
        });
      }
    }
  }
  // Staging/production: no repository placeholder secret, no init.sql DB password, secure
  // cookies, https origin (SP1.6 F6), no MinIO root password or placeholder Cloudflare secret
  // (SP3). HIBP_ENABLED stays free (owner Q2).
  assertDeployableEnv(e, (path, message) =>
    ctx.addIssue({ code: 'custom', path: [path], message }),
  );
});

export type Env = z.infer<typeof EnvSchema>;

/** Validated environment; importing this module throws at startup when the env is invalid. */
export const env: Env = EnvSchema.parse(process.env);
