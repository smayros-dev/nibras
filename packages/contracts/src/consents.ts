/** Account-level consent types (PRD §11.2 `Consent`, workspace_id NULL) a user accepts in their own name. */
export const CurrentConsentTypes = ['TERMS', 'PRIVACY', 'CODE_OF_CONDUCT', 'MARKETING'] as const;

export type CurrentConsentType = (typeof CurrentConsentTypes)[number];

/**
 * Current version of each account-level consent. Bumping one forces re-acceptance at the user's
 * next request (AC-GDPR-06).
 */
export const CONSENT_VERSIONS = {
  TERMS: 'terms-2026-10',
  PRIVACY: 'privacy-2026-10',
  CODE_OF_CONDUCT: 'coc-2026-10',
  MARKETING: 'marketing-2026-10',
} as const satisfies Record<CurrentConsentType, string>;

/** Consents every account must hold at the current version before using the app. */
export const REQUIRED_CONSENTS = [
  'TERMS',
  'PRIVACY',
] as const satisfies readonly CurrentConsentType[];
