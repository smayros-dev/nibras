import { z } from 'zod';

/** Empty strings in `.env` (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT=`) mean "unset". */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());

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
  /** `app_system` role: BYPASSRLS, never used for request handling. */
  DATABASE_URL_SYSTEM: z.url(),
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
  /** RFC 5322 sender, e.g. `TT <no-reply@example.com>`. */
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
});

export const EnvSchema = EnvObject.superRefine((e, ctx) => {
  // The log provider never delivers a code: production would lock every teacher out of phone
  // verification without anyone noticing. Staging (APP_ENV=staging) may use it.
  if (e.APP_ENV === 'production' && e.SMS_PROVIDER === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMS_PROVIDER'],
      message: 'SMS_PROVIDER=console (log only) is not allowed when APP_ENV=production',
    });
  }
}).transform((e) => ({ ...e, COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production' }));

export type Env = z.infer<typeof EnvSchema>;

/** Validated environment; importing this module throws at startup when the env is invalid. */
export const env: Env = EnvSchema.parse(process.env);
