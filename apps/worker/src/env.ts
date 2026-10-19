import { assertDeployableEnv } from '@nibras/contracts';
import { z } from 'zod';

/** Empty strings (compose `${VAR:-}`) mean "unset". */
const httpUrl = () => z.url({ protocol: /^https?$/ });
const optionalHttpUrl = z.preprocess((v) => (v === '' ? undefined : v), httpUrl().optional());
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

/**
 * The Cloudflare values the worker needs with `VIDEO_PROVIDER=cloudflare_stream`: `getAsset` and
 * `delete` only. No webhook secret (the API verifies), no signing key (the API signs playback).
 */
export const CLOUDFLARE_WORKER_VARS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
] as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Deployment tier (same values as the API); staging/production refuse dev placeholders. */
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    /** `app_system` role (BYPASSRLS, PRD §13.3): the worker spans workspaces. */
    DATABASE_URL_SYSTEM: z.url(),
    /** The DB index in the path (`redis://host:6379/8`) is honoured. */
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Health server port; `0` picks a free port (tests). */
    WORKER_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Outbound email (same values as the API). */
    SMTP_URL: z.url(),
    EMAIL_FROM: z.string().min(3),
    /** Base URL of the web app, for links in emails. */
    WEB_ORIGIN: z.url(),
    // SP3 object storage and video provider (same values as the API).
    S3_ENDPOINT: httpUrl(),
    S3_PUBLIC_ENDPOINT: optionalHttpUrl,
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9.-]{3,63}$/, 'S3_BUCKET must be a valid S3 bucket name'),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    VIDEO_PROVIDER: z.enum(['s3', 'cloudflare_stream']).default('s3'),
    CLOUDFLARE_ACCOUNT_ID: optionalString,
    CLOUDFLARE_STREAM_API_TOKEN: optionalString,
  })
  .superRefine((e, ctx) => {
    if (e.VIDEO_PROVIDER === 'cloudflare_stream') {
      for (const name of CLOUDFLARE_WORKER_VARS) {
        if (!e[name]) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when VIDEO_PROVIDER=cloudflare_stream`,
          });
        }
      }
    }
    // Staging/production: no init.sql DB password, https origin (SP1.6 F6), no MinIO root
    // password or placeholder Cloudflare token (SP3).
    assertDeployableEnv(
      {
        APP_ENV: e.APP_ENV,
        DATABASE_URL_SYSTEM: e.DATABASE_URL_SYSTEM,
        WEB_ORIGIN: e.WEB_ORIGIN,
        S3_SECRET_KEY: e.S3_SECRET_KEY,
        CLOUDFLARE_STREAM_API_TOKEN: e.CLOUDFLARE_STREAM_API_TOKEN,
      },
      (path, message) => ctx.addIssue({ code: 'custom', path: [path], message }),
    );
  });

export type WorkerEnv = z.infer<typeof EnvSchema>;

export const WORKER_ENV = Symbol('WORKER_ENV');

/** Validates the worker environment; throws listing every invalid variable. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid worker environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
