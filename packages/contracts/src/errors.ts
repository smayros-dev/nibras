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
