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
 * Deployment tiers (`APP_ENV`) allowed to honour `TEST_CONSENT_TERMS_VERSION`. An explicit
 * allow-list: an unset, empty, misspelt, `staging` or `production` tier never enables it.
 */
const TERMS_OVERRIDE_TIERS: readonly string[] = ['development'];

/**
 * E2E override for the TERMS version (server-side only, never outside development): lets tests
 * register a user and then observe a "bumped" TERMS version that must be re-accepted by the
 * consent gate. Returns the env value only — callers decide the fallback (the API reads the
 * `CONSENT_VERSIONS` import binding so a stubbed export still applies; the web layout falls back
 * here).
 *
 * Gated on `APP_ENV` alone, never on `NODE_ENV`: the e2e suite runs the production web build
 * (Next always sets `NODE_ENV=production` there) with `APP_ENV=development`, while images default
 * to `APP_ENV=production` and staging pins `APP_ENV=staging`. API and web share this function, so
 * they always agree on the version.
 */
export function testConsentTermsVersion(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  if (!TERMS_OVERRIDE_TIERS.includes(process.env.APP_ENV ?? '')) return undefined;
  return process.env.TEST_CONSENT_TERMS_VERSION || undefined;
}
