import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env';

/** HTTP-level setup shared by `main.ts` and the e2e harness, so tests run the real stack. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { frameAncestors: ["'none'"] } },
      frameguard: { action: 'deny' },
    }),
  );
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.use(cookieParser());
}
