import { z } from 'zod';

/** Empty strings in `.env` (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT=`) mean "unset". */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** `app_user` role: RLS enforced (PRD §13.3). */
  DATABASE_URL: z.url(),
  /** `app_system` role: BYPASSRLS, never used for request handling. */
  DATABASE_URL_SYSTEM: z.url(),
  REDIS_URL: z.url(),
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
});

export type Env = z.infer<typeof EnvSchema>;

/** Validated environment; importing this module throws at startup when the env is invalid. */
export const env: Env = EnvSchema.parse(process.env);
