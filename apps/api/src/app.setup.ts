import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { env } from './config/env';

export const API_PREFIX = 'api/v1';

/** Infrastructure routes served outside `/api/v1` (probes and the Prometheus scrape). */
export const UNPREFIXED_ROUTES = ['health/live', 'health/ready', 'metrics'];

/**
 * JSON body limit (Express' default is 100 kB): 1 MiB, the CSV import's `IMPORT_MAX_BYTES`
 * (SP2), carried in a JSON body. Beyond it the parser answers `413 PAYLOAD_TOO_LARGE`.
 */
export const JSON_BODY_LIMIT = '1mb';

/** HTTP-level setup shared by `main.ts` and the e2e harness, so tests run the real stack. */
export function configureApp(app: NestExpressApplication): void {
  // Nest's own logs (and `Logger` calls such as the exception filter's) go through pino.
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX, { exclude: UNPREFIXED_ROUTES });
  // Hop count, never `true`: only the known proxies' X-Forwarded-For entries are believed.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { frameAncestors: ["'none'"] } },
      frameguard: { action: 'deny' },
    }),
  );
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
