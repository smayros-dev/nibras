import { ERROR_CODES } from '@tt/contracts';

/** The API error envelope as `openapi-fetch` returns it (already parsed JSON). */
interface ErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

/** A `details.issues[]` entry as the API sends it (see `ValidationIssue` in `@tt/contracts`). */
interface WireIssue {
  path?: unknown[];
  code?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  origin?: unknown;
  format?: unknown;
  expected?: unknown;
}

/** The subset of next-intl's translator `issuesToFieldErrors` needs (`useTranslations()`). */
export interface ValidationTranslator {
  (key: string, values?: Record<string, number>): string;
  has(key: string): boolean;
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
 * Maps `VALIDATION_FAILED` zod issues (`details.issues[].path[0]`) to translated `{ field: message }`
 * so forms can show them inline; the first issue per field wins and unknown shapes yield `{}`.
 * Messages come from `validation.*` by issue code and bounds; zod's English `message` is never shown.
 */
export function issuesToFieldErrors(
  t: ValidationTranslator,
  body: unknown,
): Record<string, string> {
  const issues = (body as { details?: { issues?: unknown } } | null)?.details?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const issue of issues as (WireIssue | null)[]) {
    if (!issue) continue;
    const field = issue.path?.[0];
    if (typeof field === 'string' && !(field in out)) out[field] = issueMessage(t, issue);
  }
  return out;
}

function issueMessage(t: ValidationTranslator, issue: WireIssue): string {
  const fallback = t('validation.invalid');
  const known = (key: string, values?: Record<string, number>): string =>
    t.has(key) ? t(key, values) : fallback;
  const name = (value: unknown): string | undefined =>
    typeof value === 'string' && /^[a-z_]+$/.test(value) ? value : undefined;
  switch (issue.code) {
    case 'too_small': {
      const origin = name(issue.origin);
      return typeof issue.minimum === 'number' && origin
        ? known(`validation.too_small_${origin}`, { min: issue.minimum })
        : fallback;
    }
    case 'too_big': {
      const origin = name(issue.origin);
      return typeof issue.maximum === 'number' && origin
        ? known(`validation.too_big_${origin}`, { max: issue.maximum })
        : fallback;
    }
    // The API never sends the received type. zod 4 `.int()` reports a non-integer as
    // `expected: 'int'`; a non-numeric number input reaches the API as `null` (NaN in JSON).
    // Any other mismatch on a form means an empty field.
    case 'invalid_type':
      if (issue.expected === 'int') return t('validation.not_integer');
      if (issue.expected === 'number') return t('validation.not_number');
      return t('validation.required');
    case 'invalid_format': {
      const format = name(issue.format);
      return format ? known(`validation.invalid_format_${format}`) : fallback;
    }
    case 'invalid_value':
      return t('validation.invalid_value');
    default:
      // `custom` (contract refinements), `unrecognized_keys`, unknown or missing codes.
      return fallback;
  }
}
