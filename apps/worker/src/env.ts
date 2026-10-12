import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** `app_system` role (BYPASSRLS, PRD §13.3): the worker spans workspaces. */
  DATABASE_URL_SYSTEM: z.url(),
  /** The DB index in the path (`redis://host:6379/8`) is honoured. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** Health server port; `0` picks a free port (tests). */
  WORKER_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Outbound email (same values as the API). */
  SMTP_URL: z.url(),
  EMAIL_FROM: z.string().min(3),
  /** Base URL of the web app, for links in emails. */
  WEB_ORIGIN: z.url(),
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
