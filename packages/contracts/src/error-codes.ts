/** Stable upper-snake API error codes (PRD §12). Later sub-projects append to this tuple. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
