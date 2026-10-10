import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ApiErrorBody } from '@tt/contracts';
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

/**
 * Renders every error as `{ code, message, details?, requestId }`. Unknown errors become a
 * generic 500 (logged with their stack server-side) so internals never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { status, body } = this.render(exception);

    // Errors raised before `RequestIdMiddleware` ran (e.g. body parsing) have no context yet.
    const requestId =
      RequestContext.get()?.requestId ?? resolveRequestId(req.get(REQUEST_ID_HEADER));
    if (!res.headersSent) res.setHeader(REQUEST_ID_HEADER, requestId);

    res.status(status).json({ ...body, requestId } satisfies ApiErrorBody);
  }

  private render(exception: unknown): Rendered {
    if (exception instanceof ApiError) {
      const body: Rendered['body'] = { code: exception.code, message: exception.message };
      if (exception.details !== undefined) body.details = exception.details;
      return { status: exception.getStatus(), body };
    }
    if (exception instanceof ZodValidationException) {
      return validationFailed(zodIssues(exception.getZodError()));
    }
    if (exception instanceof BadRequestException) {
      return validationFailed([{ path: [], message: exception.message }]);
    }
    if (exception instanceof NotFoundException) {
      return { status: HttpStatus.NOT_FOUND, body: { code: 'NOT_FOUND', message: 'Not found' } };
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(error.message, error.stack);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Internal error' },
    };
  }
}

function validationFailed(issues: ValidationIssue[]): Rendered {
  return {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    body: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: { issues } },
  };
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
