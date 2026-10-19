import { Module } from '@nestjs/common';
import { redactPaths } from '@nibras/contracts';
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

/**
 * Never written in clear (Global Constraints): the shared `REDACT_KEYS` (also used by the worker),
 * at the top level and nested up to three levels (`req.headers.cookie` included).
 */
const REDACT_PATHS = redactPaths();

/** Fields of pino's standard request serializer that this API logs. */
interface SerializedRequest {
  id: unknown;
  method: string;
  url: string;
  params?: unknown;
  headers: unknown;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * A path segment that is an opaque link token (32 random bytes as base64url, 43 characters: SP2
 * invitation and guardian links travel in the path). UUIDs (36 characters) never match.
 */
const OPAQUE_TOKEN_SEGMENT = /\/[A-Za-z0-9_-]{43}(?=\/|$)/g;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** `params` with every opaque-token string masked (Express's `splat` lists the path segments). */
function maskTokenParams(value: unknown): unknown {
  if (typeof value === 'string') return OPAQUE_TOKEN.test(value) ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map(maskTokenParams);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskTokenParams(v)]));
}

/**
 * The standard request fields minus the query string: query values (emails, tokens, codes) are
 * never logged, so `url` is the path only and `query` is dropped; an opaque token in the path is
 * replaced by `[REDACTED]`, in `url` and in `params` (where Express lists the path segments).
 */
function serializeRequest(req: SerializedRequest): SerializedRequest {
  const { id, method, url, params, headers, remoteAddress, remotePort } = req;
  const path = (url.split('?', 1)[0] ?? '').replace(OPAQUE_TOKEN_SEGMENT, '/[REDACTED]');
  return {
    id,
    method,
    url: path,
    params: maskTokenParams(params),
    headers,
    remoteAddress,
    remotePort,
  };
}

/** pino-http options: JSON lines tagged `service: nibras-api` and `request_id`, secrets redacted. */
export function buildPinoOptions(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: env.LOG_LEVEL,
    base: { service: 'nibras-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req: serializeRequest,
      // Response headers (helmet, CORS, cookies) repeat on every line: keep only the status.
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
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
