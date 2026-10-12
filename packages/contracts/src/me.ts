import { z } from 'zod';
import { BirthDateSchema, TimezoneSchema } from './auth';
import { CurrentConsentTypes } from './consents';
import { LocaleSchema } from './locale';

const NameSchema = z.string().trim().min(1).max(80);

/**
 * `PATCH /me`: every key optional; unknown keys (email, phone, role…) are refused with
 * `422 VALIDATION_FAILED` (they have their own flows). `timezone` is stored in the runtime's
 * canonical IANA form, `birthDate` as `YYYY-MM-DD` between 1900-01-01 and today.
 */
export const UpdateMeSchema = z
  .object({
    firstName: NameSchema.optional(),
    lastName: NameSchema.optional(),
    locale: LocaleSchema.optional(),
    timezone: TimezoneSchema.optional(),
    birthDate: BirthDateSchema.optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof UpdateMeSchema>;

/** An account-level consent type, as a path parameter of `/me/consents/{type}`. */
export const ConsentTypeParamSchema = z.object({ type: z.enum(CurrentConsentTypes) });

export type ConsentTypeParam = z.infer<typeof ConsentTypeParamSchema>;

/**
 * `POST /me/consents/{type}`: the version the user was shown; anything other than the current
 * `CONSENT_VERSIONS[type]` is `422 CONSENT_VERSION_MISMATCH`.
 */
export const GrantConsentSchema = z.object({ version: z.string().trim().min(1).max(64) });

export type GrantConsentInput = z.infer<typeof GrantConsentSchema>;

/**
 * One granted account-level consent of `GET /me/consents` (history, newest first). `current`:
 * its version is today's `CONSENT_VERSIONS[type]`. Dates are ISO strings.
 */
export const ConsentRecordSchema = z.object({
  type: z.enum(CurrentConsentTypes),
  version: z.string(),
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
  current: z.boolean(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

/** One membership of `GET /me/workspaces` (REMOVED / REJECTED excluded), by workspace name. */
export const MyWorkspaceSchema = z.object({
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    type: z.enum(['PERSONAL', 'ORGANIZATION']),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETING']),
  }),
  role: z.enum(['OWNER', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT', 'GUARDIAN']),
  canTeach: z.boolean(),
  status: z.enum([
    'ACTIVE',
    'PENDING_APPROVAL',
    'PENDING_GUARDIAN_CONSENT',
    'SUSPENDED_NO_CONSENT',
    'SUSPENDED_CONSENT_REVOKED',
  ]),
});

export type MyWorkspace = z.infer<typeof MyWorkspaceSchema>;
