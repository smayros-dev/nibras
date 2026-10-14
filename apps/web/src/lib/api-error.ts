import { ERROR_CODES } from '@tt/contracts';

/** The API error envelope as `openapi-fetch` returns it (already parsed JSON). */
interface ErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

interface ZodIssue {
  path?: unknown[];
  message?: string;
}

/**
 * Translated message for an API error: a known `ERROR_CODE` maps to `errors.<code>`, anything
 * else (network failure, non-JSON body) to the generic internal-error string.
 */
export function apiErrorMessage(t: (key: string) => string, body: unknown): string {
  const code = (body as ErrorBody | null)?.code;
  if (code && (ERROR_CODES as readonly string[]).includes(code)) {
    return t(`errors.${code}`);
  }
  return t('errors.INTERNAL_ERROR');
}

/**
 * Maps `VALIDATION_FAILED` zod issues (`details.issues[].path[0]`) to `{ field: message }` so
 * forms can show them inline; unknown shapes yield `{}`.
 */
export function issuesToFieldErrors(body: unknown): Record<string, string> {
  const issues = (body as { details?: { issues?: ZodIssue[] } } | null)?.details?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path?.[0];
    if (typeof field === 'string' && typeof issue.message === 'string' && !(field in out)) {
      out[field] = issue.message;
    }
  }
  return out;
}
