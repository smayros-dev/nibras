import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@tt/contracts';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';
import { RequestContext } from './request-context';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.middleware';
import { ZodValidationException } from './zod-validation.pipe';

interface ValidationIssue {
  path: PropertyKey[];
  message: string;
}

type Rendered = { status: number; body: Omit<ApiErrorBody, 'requestId'> };

/** Client errors by status. Messages are fixed: an exception's own message is never sent. */
const CLIENT_ERRORS: Record<number, { code: ErrorCode; message: string }> = {
  401: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
  403: { code: 'PERMISSION_DENIED', message: 'Permission denied' },
  404: { code: 'NOT_FOUND', message: 'Not found' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
};

/**
 * Renders every error as `{ code, message, details?, requestId }`:
 * - `ApiError` → its own status, code, message and details;
 * - zod validation → 422 `VALIDATION_FAILED` with `details.issues[{ path, message }]`;
 * - other 400s (malformed body, parse pipes) → 422 `VALIDATION_FAILED`;
 * - 401/403/404/413/415/429 → their code; any other 4xx → 400 `VALIDATION_FAILED`;
 * - 503 → `SERVICE_UNAVAILABLE`; anything else → 500 `INTERNAL_ERROR`.
 * 4xx come from `HttpException`s or exposed http-errors (body-parser). Only 5xx are logged at
 * error level with the stack, so internals stay server-side.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { status, body } = this.render(exception);

    // The handler already started streaming: no envelope possible, just close the response.
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }

    // Errors raised before `RequestIdMiddleware` ran (e.g. body parsing) have no context yet.
    const requestId =
      RequestContext.get()?.requestId ?? resolveRequestId(req.get(REQUEST_ID_HEADER));
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(status).json({ ...body, requestId } satisfies ApiErrorBody);
  }

  private render(exception: unknown): Rendered {
    if (exception instanceof ApiError) {
      const body: Rendered['body'] = { code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return { status: exception.getStatus(), body };
    }
    if (exception instanceof ZodValidationException) {
      return validationFailed('Validation failed', { issues: zodIssues(exception.getZodError()) });
    }

    const status = clientErrorStatus(exception);
    if (status !== undefined) {
      this.logger.debug(`client error ${status} (${errorName(exception)})`);
      if (status === 400) {
        // Nest turns body-parser syntax errors (and bad URI encoding) into a bare 400 whose
        // message quotes the input, so a single fixed message covers every non-zod 400.
        return validationFailed('Malformed request');
      }
      const known = CLIENT_ERRORS[status];
      if (known) return { status, body: { ...known } };
      return { status: 400, body: { code: 'VALIDATION_FAILED', message: 'Bad request' } };
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(error.message, error.stack);
    if (exception instanceof HttpException && exception.getStatus() === 503) {
      return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' } };
    }
    return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Internal error' } };
  }
}

/** The 4xx status of an `HttpException` or of an exposed http-error (body-parser), if any. */
function clientErrorStatus(exception: unknown): number | undefined {
  let status: unknown;
  if (exception instanceof HttpException) {
    status = exception.getStatus();
  } else if (isExposedHttpError(exception)) {
    status = exception.status ?? exception.statusCode;
  }
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

interface HttpErrorLike {
  expose: true;
  status?: number;
  statusCode?: number;
}

function isExposedHttpError(value: unknown): value is HttpErrorLike {
  return typeof value === 'object' && value !== null && (value as HttpErrorLike).expose === true;
}

function errorName(exception: unknown): string {
  return exception instanceof Error ? exception.name : typeof exception;
}

function validationFailed(message: string, details?: { issues: ValidationIssue[] }): Rendered {
  const body: Rendered['body'] = { code: 'VALIDATION_FAILED', message };
  if (details) body.details = details;
  return { status: 422, body };
}

/** Keeps only `path` and `message` from zod issues (no received values echoed back). */
function zodIssues(zodError: unknown): ValidationIssue[] {
  const issues = (zodError as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: { path?: PropertyKey[]; message?: string }) => ({
    path: issue.path ?? [],
    message: issue.message ?? 'Invalid value',
  }));
}
