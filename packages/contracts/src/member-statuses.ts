// Zod-free (exported by `@nibras/contracts/web` for browser bundles); the schemas are in members.ts.
/** PRD §11.1 `MembershipStatus`. */
export const MEMBERSHIP_STATUSES = [
  'ACTIVE',
  'PENDING_APPROVAL',
  'PENDING_GUARDIAN_CONSENT',
  'SUSPENDED_NO_CONSENT',
  'SUSPENDED_CONSENT_REVOKED',
  'REMOVED',
  'REJECTED',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
