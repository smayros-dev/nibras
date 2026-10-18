import type { CurrentConsentType, MeUser } from '@nibras/contracts';
import type { User } from '@nibras/db';

type MeUserSource = Pick<
  User,
  | 'id'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'locale'
  | 'timezone'
  | 'birthDate'
  | 'phoneE164'
  | 'phoneVerifiedAt'
  | 'emailVerifiedAt'
  | 'platformRole'
  | 'status'
  | 'totpEnabledAt'
>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Serialises a user as `MeUser` (whitelist: never hashes or secrets). `twoFactorRequired` and
 * `pendingConsents` are computed by the caller (Tasks 10 and 11).
 */
export function toMeUser(
  user: MeUserSource,
  extra: { twoFactorRequired: boolean; pendingConsents: CurrentConsentType[] },
): MeUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    locale: user.locale,
    timezone: user.timezone,
    birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
    phoneE164: user.phoneE164,
    phoneVerifiedAt: iso(user.phoneVerifiedAt),
    emailVerifiedAt: iso(user.emailVerifiedAt),
    platformRole: user.platformRole,
    status: user.status,
    twoFactor: { enabled: user.totpEnabledAt !== null, required: extra.twoFactorRequired },
    pendingConsents: extra.pendingConsents,
  };
}
