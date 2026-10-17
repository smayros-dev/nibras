import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode, ValidationIssue } from '@tt/contracts';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';
import { RequestContext } from './request-context';
import { REQUEST_ID_HEADER, requestIdOf } from './request-id.middleware';
import { ZodValidationException } from './zod-validation.pipe';

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
 * - zod validation → 422 `VALIDATION_FAILED` with `details.issues[{ path, message, code, … }]`;
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
    const requestId = RequestContext.get()?.requestId ?? requestIdOf(req);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const retryAfterS = retryAfterOf(status, body.details);
    if (retryAfterS !== undefined) res.setHeader('Retry-After', String(retryAfterS));
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

/** `details.retryAfterS` of a 429 (login throttle, rate limits): sent as `Retry-After` too. */
function retryAfterOf(status: number, details: unknown): number | undefined {
  if (status !== 429 || typeof details !== 'object' || details === null) return undefined;
  const value = (details as { retryAfterS?: unknown }).retryAfterS;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;
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

/** Raw zod 4 issue fields the filter may read; anything else (`input`, `values`, …) is dropped. */
interface RawZodIssue {
  path?: PropertyKey[];
  message?: string;
  code?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  origin?: unknown;
  expected?: unknown;
  format?: unknown;
}

/**
 * Whitelists zod issue fields: `path`, `message`, `code`, and per code the bounds or type/format
 * names (`too_small` → `minimum` + `origin`, `too_big` → `maximum` + `origin`, `invalid_type` →
 * `expected`, `invalid_format` → `format`). Received values are never echoed back.
 */
function zodIssues(zodError: unknown): ValidationIssue[] {
  const issues = (zodError as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: RawZodIssue) => {
    const out: ValidationIssue = {
      path: (issue.path ?? []).map((key) => (typeof key === 'symbol' ? String(key) : key)),
      message: issue.message ?? 'Invalid value',
    };
    if (typeof issue.code !== 'string') return out;
    out.code = issue.code;
    switch (issue.code) {
      case 'too_small':
        setBound(out, 'minimum', issue.minimum);
        setName(out, 'origin', issue.origin);
        break;
      case 'too_big':
        setBound(out, 'maximum', issue.maximum);
        setName(out, 'origin', issue.origin);
        break;
      case 'invalid_type':
        setName(out, 'expected', issue.expected);
        break;
      case 'invalid_format':
        setName(out, 'format', issue.format);
        break;
    }
    return out;
  });
}

/** A schema bound (number or bigint) as a finite JSON number; anything else is dropped. */
function setBound(out: ValidationIssue, key: 'minimum' | 'maximum', value: unknown): void {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
}

/** A schema-defined name (type, origin, format): a short identifier, never user input. */
function setName(
  out: ValidationIssue,
  key: 'origin' | 'expected' | 'format',
  value: unknown,
): void {
  if (typeof value === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(value)) out[key] = value;
}
