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

/**
 * E2E override for the TERMS version (server-side only, never in production): lets tests register
 * a user and then observe a "bumped" TERMS version that must be re-accepted by the consent gate.
 * Returns the env value only — callers decide the fallback (the API reads the `CONSENT_VERSIONS`
 * import binding so a stubbed export still applies; the web layout falls back here).
 *
 * A production build (`NODE_ENV=production`) ignores it unless its deployment explicitly says
 * `APP_ENV=development`: the e2e suite runs the production web build (Next always sets
 * `NODE_ENV=production` there), while real deployments run with `APP_ENV` unset or
 * `staging`/`production`. API and web share this function, so they always agree on the version.
 */
export function testConsentTermsVersion(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  if (process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'development') {
    return undefined;
  }
  return process.env.TEST_CONSENT_TERMS_VERSION || undefined;
}
