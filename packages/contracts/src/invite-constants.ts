// Zod-free (exported by `@nibras/contracts/web` for browser bundles); the schemas are in
// invitations.ts, invite-links.ts, guardian.ts, students.ts and imports.ts.
import type { Locale } from './locale-codes';
import type { MembershipRole } from './permissions';

/** PRD §11.1 `InvitationStatus` (a stored `PENDING` past `expiresAt` is served as `EXPIRED`). */
export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** PRD §11.1 `InviteLinkStatus` (`EXPIRED` is derived from `expiresAt`). */
export const INVITE_LINK_STATUSES = ['ACTIVE', 'DISABLED', 'EXHAUSTED', 'EXPIRED'] as const;
export type InviteLinkStatus = (typeof INVITE_LINK_STATUSES)[number];

/** `GuardianLink.status`: PRD §11.1 plus `REFUSED` (a refusal writes no `Consent` row). */
export const GUARDIAN_LINK_STATUSES = ['PENDING', 'ACTIVE', 'REFUSED', 'REVOKED'] as const;
export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number];

/** « Lien de parenté » of the guardian consent form (PRD §8.3.5). */
export const GUARDIAN_RELATIONSHIPS = ['PARENT', 'LEGAL_GUARDIAN', 'OTHER'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

/** Roles an email invitation may carry (TEACHER / ADMIN: organisations only). */
export const INVITABLE_ROLES = [
  'STUDENT',
  'TEACHER',
  'ADMIN',
] as const satisfies readonly MembershipRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** `InvitationImport.status`. */
export const IMPORT_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * Per-line outcome of a CSV import: preview outcomes (`OK*` rows are valid, the `OK_*` ones carry
 * a warning; the others are invalid) and the job outcomes `CREATED` / `FAILED` (email failure:
 * the invitation exists and can be resent).
 */
export const IMPORT_ROW_OUTCOMES = [
  'OK',
  'OK_COURSES_IGNORED',
  'OK_GUARDIAN_AT_ACCEPT',
  'INVALID_EMAIL',
  'DUPLICATE_IN_FILE',
  'ALREADY_MEMBER',
  'ALREADY_INVITED',
  'INVALID_BIRTH_DATE',
  'INVALID_GUARDIAN_EMAIL',
  'CREATED',
  'FAILED',
] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];

const DAY_MS = 24 * 3600 * 1000;

/** An email invitation is valid 7 days. */
export const INVITATION_TTL_MS = 7 * DAY_MS;
/** Minimum delay between two sends of one invitation. */
export const INVITATION_RESEND_WINDOW_S = 600;
/** A guardian consent request is valid 14 days, then the membership is suspended (no purge). */
export const GUARDIAN_CONSENT_TTL_MS = 14 * DAY_MS;
/** Minimum delay between two sends of one guardian consent request. */
export const GUARDIAN_CONSENT_RESEND_WINDOW_S = 600;
/** Minor = strictly under 18, everywhere (D-P3). */
export const MINOR_AGE_THRESHOLD = 18;
/** Invite codes: upper-case letters and digits without the ambiguous `0 O 1 I`. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;
export const INVITE_LINK_DEFAULT_MAX_USES = 50;
export const INVITE_LINK_DEFAULT_TTL_DAYS = 30;
/** CSV import bounds (rows after the header; file size in bytes). */
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1_048_576;
/** Failed public token / code lookups allowed per IP and minute before `429`. */
export const TOKEN_ATTEMPTS_PER_MIN = 10;

const INVITE_CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** A typed or pasted code, trimmed and upper-cased; `null` unless it is 8 alphabet characters. */
export function normaliseInviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}

/** `ahmed@example.com` → `a***@example.com`; a one-character local part → `*@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return local.length <= 1 ? `*${domain}` : `${local[0]}***${domain}`;
}

/**
 * True when someone born on `birthDate` (`YYYY-MM-DD`) is under 18 on `at`'s UTC calendar date:
 * the 18th birthday is the first adult day; a 29 February birth becomes adult on 1 March of a
 * non-leap year.
 */
export function isMinor(birthDate: string, at: Date = new Date()): boolean {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  // Date.UTC rolls 29 February of a non-leap year over to 1 March.
  const adultFrom = new Date(Date.UTC(y + MINOR_AGE_THRESHOLD, m - 1, d))
    .toISOString()
    .slice(0, 10);
  return adultFrom > at.toISOString().slice(0, 10);
}

function link(origin: string, locale: Locale, path: string, value: string): string {
  return `${origin.replace(/\/+$/, '')}/${locale}/${path}/${encodeURIComponent(value)}`;
}

/** Public invitation page: `{origin}/{locale}/invite/{raw}`. */
export const invitationLink = (origin: string, locale: Locale, raw: string): string =>
  link(origin, locale, 'invite', raw);

/** Public join page of an invite code: `{origin}/{locale}/join/{code}`. */
export const joinLink = (origin: string, locale: Locale, code: string): string =>
  link(origin, locale, 'join', code);

/** Guardian consent request page: `{origin}/{locale}/guardian-consent/{raw}`. */
export const guardianConsentLink = (origin: string, locale: Locale, raw: string): string =>
  link(origin, locale, 'guardian-consent', raw);

/** Long-lived guardian page (view, revoke, re-grant): `{origin}/{locale}/guardian/{raw}`. */
export const guardianPageLink = (origin: string, locale: Locale, raw: string): string =>
  link(origin, locale, 'guardian', raw);
