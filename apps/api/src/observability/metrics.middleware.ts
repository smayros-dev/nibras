import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { httpRequestDuration } from './metrics';

/**
 * Times every HTTP request into `http_request_duration_seconds`, including those rejected before
 * a handler runs (unknown routes, body parsing, guards' 401/403). The sample is taken when the
 * response closes, so the status is the final one and the route is the handler's route template
 * resolved by then; unmatched requests are labelled `unknown`, never with their raw URL.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const stopTimer = httpRequestDuration.startTimer();
    // Nest mounts middleware as an Express route (`/api/v1{/*splat}`), so `req.route` is already
    // set here; only a different route object at close time means a handler's route matched.
    const middlewareRoute: unknown = req.route;
    res.once('close', () => {
      const route = req.route === middlewareRoute ? 'unknown' : routeTemplate(req);
      stopTimer({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  }
}

/** The matched Express route pattern (e.g. `/api/v1/items/:id`), not the requested path. */
function routeTemplate(req: Request): string {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : 'unknown';
}
