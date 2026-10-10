import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';
/** Client ids end up in headers and logs: a strict charset rules out injection. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses a well-formed incoming `X-Request-Id`, otherwise generates a UUID. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * The request's id, resolved once and cached on `req.id`: pino-http (`genReqId`), this middleware
 * and the exception filter all see the same value, whichever runs first.
 */
export function requestIdOf(req: IncomingMessage): string {
  if (typeof req.id === 'string') return req.id;
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER.toLowerCase()]);
  req.id = requestId;
  return requestId;
}

/** Assigns the request id, echoes it in the response and opens the `RequestContext`. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = requestIdOf(req);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const store = { requestId, ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' };
    RequestContext.run(store, () => next());
  }
}
