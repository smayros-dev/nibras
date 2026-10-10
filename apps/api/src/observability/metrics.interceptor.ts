import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { httpRequestDuration } from './metrics';

/**
 * Times every routed HTTP request into `http_request_duration_seconds`. The sample is taken when
 * the response closes, so the status is the final one (including errors rendered by the filter).
 * Requests rejected before the handler pipeline (unknown routes, body parsing, guards) are not
 * timed: they have no interceptor run.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const stopTimer = httpRequestDuration.startTimer();
    res.once('close', () => {
      stopTimer({ method: req.method, route: routeTemplate(req), status: String(res.statusCode) });
    });
    return next.handle();
  }
}

/** The matched Express route pattern (e.g. `/api/v1/items/:id`), not the requested path. */
function routeTemplate(req: Request): string {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` : 'unknown';
}
