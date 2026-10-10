import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const MAX_REQUEST_ID_LENGTH = 128;

/** Reuses a sane incoming `X-Request-Id`, otherwise generates a UUID. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' &&
    incoming.length > 0 &&
    incoming.length <= MAX_REQUEST_ID_LENGTH
    ? incoming
    : randomUUID();
}

/** Assigns the request id, echoes it in the response and opens the `RequestContext`. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.get(REQUEST_ID_HEADER));
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const store = { requestId, ip: req.ip ?? '', userAgent: req.get('user-agent') ?? '' };
    RequestContext.run(store, () => next());
  }
}
