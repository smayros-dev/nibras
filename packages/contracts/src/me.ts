import { isValidPhoneNumber, parsePhoneNumberWithError } from 'libphonenumber-js';
import { z } from 'zod';
import { BirthDateSchema, OtpCodeSchema, TimezoneSchema } from './auth';
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

/** E.164 shape: `+`, a country code not starting with 0, at most 15 digits, nothing else. */
const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * A phone number as `/me/phone/request-otp` takes it: already in E.164 (no spaces, no national
 * `0` prefix) and valid for its country per `libphonenumber-js` (`isValidPhoneNumber`); the
 * output is libphonenumber's E.164 form. Anything else is `422 VALIDATION_FAILED`.
 */
export const PhoneE164Schema = z
  .string()
  .trim()
  .regex(E164, 'Expected an E.164 phone number, e.g. +21655123456')
  .refine((v) => isValidPhoneNumber(v), 'Invalid phone number')
  .transform((v) => parsePhoneNumberWithError(v).number);

/**
 * `POST /me/phone/request-otp`: `202 {}`; a 6-digit code goes by SMS to `phoneE164` (and, outside
 * production, by email). 1 request per minute per user (`429 RATE_LIMITED`).
 */
export const PhoneOtpRequestSchema = z.object({ phoneE164: PhoneE164Schema });

export type PhoneOtpRequestInput = z.infer<typeof PhoneOtpRequestSchema>;

/**
 * `POST /me/phone/verify-otp`: `200 MeUser`; wrong code `422 OTP_INVALID`; expired, unknown or
 * past 5 attempts `410 OTP_EXPIRED`.
 */
export const PhoneOtpVerifySchema = z.object({ otpCode: OtpCodeSchema });

export type PhoneOtpVerifyInput = z.infer<typeof PhoneOtpVerifySchema>;

/** A step a teacher must complete before inviting, publishing or opening a room (D-O6). */
export const TeacherVerificationSteps = ['EMAIL', 'PHONE', 'CODE_OF_CONDUCT'] as const;

export type TeacherVerificationStep = (typeof TeacherVerificationSteps)[number];

/**
 * `GET /me/verification`, and `details.missing` of `403 TEACHER_NOT_VERIFIED`: the code of
 * conduct counts only when accepted (unrevoked) at its current `CONSENT_VERSIONS` version.
 * `missing` follows the order of `TeacherVerificationSteps`.
 */
export const TeacherVerificationSchema = z.object({
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  codeOfConductAccepted: z.boolean(),
  missing: z.array(z.enum(TeacherVerificationSteps)),
});

export type TeacherVerification = z.infer<typeof TeacherVerificationSchema>;
