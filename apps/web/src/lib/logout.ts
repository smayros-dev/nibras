import { CHALLENGE_STORAGE_KEY } from './two-factor-challenge';

/** The subset of the locale-aware router `logout` needs. */
export interface LogoutRouter {
  replace(href: string): void;
  refresh(): void;
}

/**
 * `POST /auth/logout` (public; on success it clears both cookies) and forgets any pending 2FA
 * challenge (client-only state, dropped whatever the answer). Resolves `true` when logged out; on
 * a network error or a non-2xx answer the cookies may still be set and it resolves `false`.
 * Callers that stay on the page (the invitation page's « Se déconnecter et continuer ») refresh
 * the router themselves.
 */
export async function endSession(): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
    ok = res.ok;
  } catch {
    ok = false;
  }
  try {
    sessionStorage.removeItem(CHALLENGE_STORAGE_KEY);
  } catch {
    // Storage blocked.
  }
  return ok;
}

/**
 * Ends the session ({@link endSession}), then goes to login and drops the router cache so no
 * authenticated RSC payload is reused. Resolves `true` when logged out.
 *
 * On failure the user is NOT sent to login as if logged out: it resolves `false` (the caller shows
 * an error toast) and stays put.
 */
export async function logout(router: LogoutRouter): Promise<boolean> {
  if (!(await endSession())) return false;
  router.replace('/login');
  router.refresh();
  return true;
}
