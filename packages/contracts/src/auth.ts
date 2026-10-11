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
