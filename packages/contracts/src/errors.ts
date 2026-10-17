import { z } from 'zod';
import { ERROR_CODES } from './error-codes';

/** API error envelope: exactly `{ code, message, details?, requestId }` (PRD §12). */
export const ApiErrorBodySchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/**
 * One entry of `VALIDATION_FAILED` `details.issues[]`. `message` is zod's English text (never
 * shown by the web); `code` and the bounds let clients translate it. Received values are never
 * sent back.
 */
export const ValidationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  origin: z.string().optional(),
  expected: z.string().optional(),
  format: z.string().optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
