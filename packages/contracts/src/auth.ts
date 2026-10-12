import { z } from 'zod';
import { CurrentConsentTypes } from './consents';
import { LocaleSchema } from './locale';

/**
 * Shape of an IANA region zone (`Area/Location`, optionally `Area/Region/Location`) or `UTC`.
 * Refuses raw offsets (`GMT+1`, `+01:00`) and legacy single names (`EST5EDT`, `CET`).
 */
const TIME_ZONE_SHAPE = /^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/**
 * The runtime's canonical name of `tz` (`resolvedOptions().timeZone`, e.g. the case-folded name
 * or the alias ICU/CLDR prefers: `Asia/Kolkata` and `Asia/Calcutta` resolve to the same value),
 * or `null` when `tz` is not an accepted IANA zone. Every zone the runtime can resolve is
 * accepted, not only `Intl.supportedValuesOf('timeZone')`, which omits aliases such as
 * `Asia/Kolkata` or `Europe/Kyiv` on some ICU versions.
 *
 * `Etc/*` is refused on purpose: its offset zones have inverted signs (`Etc/GMT+1` is UTC−1) and
 * `Etc/UTC` is spelled `UTC` here.
 */
export function canonicalTimeZone(tz: string): string | null {
  if (!TIME_ZONE_SHAPE.test(tz) || /^etc\//i.test(tz)) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(tz: string): boolean {
  return canonicalTimeZone(tz) !== null;
}

/** IANA time zone, output in the runtime's canonical form (what the API stores). */
export const TimezoneSchema = z
  .string()
  .refine(isValidTimeZone, 'Invalid IANA time zone')
  .transform((tz) => canonicalTimeZone(tz)!);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const BIRTH_DATE_MIN = '1900-01-01';

/** `YYYY-MM-DD` that exists in the calendar (no 2001-02-29, no month 13). */
function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Today's date (UTC) as `YYYY-MM-DD`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO calendar date between 1900-01-01 and today (UTC), kept as the `YYYY-MM-DD` string. */
export const BirthDateSchema = z
  .string()
  .refine(isCalendarDate, 'Invalid date (expected YYYY-MM-DD)')
  .refine((d) => d >= BIRTH_DATE_MIN, 'Birth date before 1900-01-01')
  .refine((d) => d <= todayIso(), 'Birth date in the future');

const NameSchema = z.string().trim().min(1).max(80);

/**
 * "Je suis professeur" sign-up (PRD §8.1.1). Email identity is case-insensitive: the address is
 * trimmed and lower-cased here, so every entry point stores and matches the same form. SP2
 * extends `kind` with `'INVITED'`.
 */
export const RegisterTeacherSchema = z.object({
  kind: z.literal('TEACHER'),
  firstName: NameSchema,
  lastName: NameSchema,
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(256),
  locale: LocaleSchema,
  timezone: TimezoneSchema,
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
});

export type RegisterTeacherInput = z.infer<typeof RegisterTeacherSchema>;

/** Raw tokens are 43 base64url characters; the cap only bounds the hashing work. */
export const VerifyEmailSchema = z.object({ token: z.string().min(1).max(512) });

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;

/**
 * The signed-in user as the API returns it (never hashes or secrets). Dates are ISO strings,
 * `birthDate` is `YYYY-MM-DD`.
 */
export const MeUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  locale: LocaleSchema,
  timezone: z.string(),
  birthDate: z.string().nullable(),
  phoneE164: z.string().nullable(),
  phoneVerifiedAt: z.string().nullable(),
  emailVerifiedAt: z.string().nullable(),
  platformRole: z.enum(['NONE', 'SUPER_ADMIN']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETING', 'DELETED']),
  twoFactor: z.object({ enabled: z.boolean(), required: z.boolean() }),
  pendingConsents: z.array(z.enum(CurrentConsentTypes)),
});

export type MeUser = z.infer<typeof MeUserSchema>;

/**
 * `POST /auth/login`. The email is normalised exactly like at registration (trimmed,
 * lower-cased). `remember` = "Se souvenir de cet appareil": a persistent 30-day refresh cookie
 * instead of a browser-session one (the server-side lifetime is 30 days either way).
 */
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  remember: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * `200` of `POST /auth/login`: cookies set on `OK`. `TWO_FACTOR_REQUIRED` (TOTP enabled): no
 * cookies, the 5-minute `challengeToken` goes to `POST /auth/2fa/verify` or `/auth/2fa/recovery`.
 */
export const LoginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK'), user: MeUserSchema }),
  z.object({ status: z.literal('TWO_FACTOR_REQUIRED'), challengeToken: z.string() }),
]);

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** A 6-digit TOTP code (surrounding spaces ignored). Never named `code` (log redaction rule). */
export const OtpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Expected a 6-digit code');

/** A recovery code as typed: `xxxxx-xxxxx`, compared case-insensitively. */
export const RecoveryCodeSchema = z.string().trim().toLowerCase().min(1).max(32);

/** The login challenge of a `TWO_FACTOR_REQUIRED` login. */
const ChallengeTokenSchema = z.string().min(1).max(2048);

/** `200` of `POST /auth/2fa/setup`: the seed to scan or type (2FA stays off until confirmed). */
export const TwoFactorSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
});

export type TwoFactorSetupResponse = z.infer<typeof TwoFactorSetupResponseSchema>;

/**
 * `POST /auth/2fa/verify`, two modes:
 * - signed in, setup pending, no `challengeToken` → confirms the setup: `200 { recoveryCodes }`;
 * - `challengeToken` of a `TWO_FACTOR_REQUIRED` login → completes it: `200 { status: 'OK', user }`
 *   and the auth cookies (`remember` as at login).
 */
export const TwoFactorVerifySchema = z.object({
  otpCode: OtpCodeSchema,
  challengeToken: ChallengeTokenSchema.optional(),
  remember: z.boolean().optional().default(false),
});

export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifySchema>;

/** `200` of the setup confirmation: the 10 single-use recovery codes, shown this once only. */
export const TwoFactorRecoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()) });

export type TwoFactorRecoveryCodes = z.infer<typeof TwoFactorRecoveryCodesSchema>;

/** `POST /auth/2fa/recovery`: completes a login with one recovery code (consumed). */
export const TwoFactorRecoverySchema = z.object({
  challengeToken: ChallengeTokenSchema,
  recoveryCode: RecoveryCodeSchema,
  remember: z.boolean().optional().default(false),
});

export type TwoFactorRecoveryInput = z.infer<typeof TwoFactorRecoverySchema>;

/** `POST /auth/2fa/disable`: `204`; `403 TWO_FACTOR_MANDATORY` when the role requires 2FA. */
export const TwoFactorDisableSchema = z.object({ otpCode: OtpCodeSchema });

export type TwoFactorDisableInput = z.infer<typeof TwoFactorDisableSchema>;

/** One active session of the signed-in user (`GET /auth/sessions`); dates are ISO strings. */
export const SessionSummarySchema = z.object({
  id: z.string(),
  /** Browser and OS derived from the user-agent, e.g. `Firefox · Windows`. */
  deviceLabel: z.string(),
  /** Address of the last sign-in or refresh. */
  ip: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  /** The session making this request. */
  current: z.boolean(),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** An email address as every entry point normalises it: trimmed, lower-cased (column is citext). */
const EmailAddressSchema = z.string().trim().toLowerCase().email().max(254);

/** A new password as the web forms check it; the API reports policy failures as `PASSWORD_*`. */
const NewPasswordSchema = z.string().min(12).max(256);

/** `POST /auth/password/forgot`: always `202 {}`, whether or not the account exists. */
export const ForgotPasswordSchema = z.object({ email: EmailAddressSchema });

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** `POST /auth/password/reset`: the token of the emailed link (1 h, single use). */
export const ResetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: NewPasswordSchema,
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/** `PATCH /me/password`: every other session is revoked. */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: NewPasswordSchema,
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** `POST /me/email-change`: a confirmation link goes to the current AND the new address. */
export const EmailChangeRequestSchema = z.object({
  newEmail: EmailAddressSchema,
  password: z.string().min(1).max(256),
});

export type EmailChangeRequestInput = z.infer<typeof EmailChangeRequestSchema>;

/** `POST /auth/email-change/confirm`: either side's token (24 h, single use). */
export const EmailChangeConfirmSchema = z.object({ token: z.string().min(1).max(512) });

export type EmailChangeConfirmInput = z.infer<typeof EmailChangeConfirmSchema>;

/**
 * `200` of `POST /auth/email-change/confirm`: the side still to confirm (`OLD` = the current
 * address, `NEW` = the new one), or `null` once both are confirmed and the email has changed.
 */
export const EmailChangeConfirmResponseSchema = z.object({
  pending: z.enum(['OLD', 'NEW']).nullable(),
});

export type EmailChangeConfirmResponse = z.infer<typeof EmailChangeConfirmResponseSchema>;
