import { Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import { requestIdOf } from '../common/request-id.middleware';
import { env, type Env } from '../config/env';

/**
 * Optional pino destination (tests write to memory); `null` means stdout, or the pretty
 * transport in development.
 */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

/** Never written in clear (Global Constraints): at the top level and nested up to two levels. */
const SENSITIVE_KEYS = ['email', 'password', 'authorization', 'cookie'];

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

/** pino-http options: JSON lines tagged `service: tt-api` and `request_id`, secrets redacted. */
export function buildPinoOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: env.LOG_LEVEL,
    base: { service: 'tt-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Response headers (helmet, CORS, cookies) repeat on every line: keep only the status.
    serializers: { res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }) },
    // Same id as `X-Request-Id` and `RequestContext` (resolved once, cached on `req.id`).
    genReqId: (req) => requestIdOf(req),
    // Bound to the request logger: every line logged while handling the request carries it.
    customProps: (req) => ({ request_id: req.id }),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
  };
  if (destination) return { pinoHttp: [options, destination] };
  if (env.NODE_ENV === 'development') options.transport = { target: 'pino-pretty' };
  return { pinoHttp: options };
}

/** nestjs-pino wired to the validated env; `LOG_DESTINATION` is overridable in tests. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      providers: [{ provide: LOG_DESTINATION, useValue: null }],
      inject: [LOG_DESTINATION],
      useFactory: (destination: DestinationStream | null) =>
        buildPinoOptions(env, destination ?? undefined),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
