import { z } from 'zod';
import { CurrentConsentTypes } from './consents';
import { LocaleSchema } from './locale';

let ianaZones: ReadonlySet<string> | undefined;

/**
 * IANA zone known to the runtime's ICU data (`Intl.supportedValuesOf('timeZone')`, canonical
 * names only, case-sensitive), or `UTC`, which some runtimes leave out of that list.
 */
export function isValidTimeZone(tz: string): boolean {
  ianaZones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return tz === 'UTC' || ianaZones.has(tz);
}

export const TimezoneSchema = z.string().refine(isValidTimeZone, 'Invalid IANA time zone');

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
