/** Gate paths under `/{locale}` (locale-aware prefixes are added by callers). */
export const AUTH_ROUTES = {
  login: 'login',
  register: 'register',
  verifyEmail: 'verify-email',
  twoFactor: '2fa',
  twoFactorSetup: '2fa/setup',
  forgotPassword: 'forgot-password',
  app: 'app',
} as const;

/**
 * Where the `(app)` layout sends a visitor whose session is not yet usable. Ordered like the API
 * gate (suspended users never reach the app: `getSession()` returns null): email verification
 * first, then mandatory 2FA setup; pending consents are rendered in place (the ConsentGate),
 * not a redirect. `null` when the session may enter the app.
 */
export function appGateRedirect(user: {
  emailVerifiedAt: string | null;
  twoFactor: { enabled: boolean; required: boolean };
}): string | null {
  if (user.emailVerifiedAt === null) return AUTH_ROUTES.verifyEmail;
  if (user.twoFactor.required && !user.twoFactor.enabled) return AUTH_ROUTES.twoFactorSetup;
  return null;
}
