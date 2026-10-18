import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@nibras/contracts';

/**
 * The only way to raise a domain error: the global filter renders it as
 * `{ code, message, details?, requestId }` with `status`.
 */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
