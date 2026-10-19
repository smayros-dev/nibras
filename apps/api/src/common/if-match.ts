import { createParamDecorator, HttpStatus, type ExecutionContext } from '@nestjs/common';
import { etagOf, parseIfMatch } from '@nibras/contracts';
import { ApiError } from './api-error';

interface HeaderSource {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The course version named by the request's `If-Match` header (D-P14, spec D8): `"7"`, `7` or
 * `W/"7"` → `7`; missing, `*`, a list or anything else → `null`. It does not throw: the service
 * loads the resource first (a foreign or deleted id stays `404`) and then calls
 * {@link assertVersion}, which turns `null` into `428 VERSION_REQUIRED`.
 */
export function ifMatchVersion(req: HeaderSource): number | null {
  const header = req.headers['if-match'];
  return typeof header === 'string' ? parseIfMatch(header) : null;
}

/** `@IfMatch() expected: number | null` — see {@link ifMatchVersion}. */
export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | null =>
    ifMatchVersion(ctx.switchToHttp().getRequest<HeaderSource>()),
);

/**
 * Optimistic locking (D-P20): no version → `428 VERSION_REQUIRED`; another version than the
 * locked row's → `409 VERSION_CONFLICT { currentVersion }` (the editor offers « écraser » with it).
 */
export function assertVersion(current: number, expected: number | null): void {
  if (expected === null) {
    throw new ApiError(
      HttpStatus.PRECONDITION_REQUIRED,
      'VERSION_REQUIRED',
      'An If-Match header with the current version is required',
    );
  }
  if (expected !== current) {
    throw new ApiError(HttpStatus.CONFLICT, 'VERSION_CONFLICT', 'The resource has changed', {
      currentVersion: current,
    });
  }
}

/** `ETag: "<version>"` (Express keeps a set ETag instead of computing its own). */
export function setEtag(res: { setHeader(name: string, value: string): unknown }, version: number) {
  res.setHeader('ETag', etagOf(version));
}
