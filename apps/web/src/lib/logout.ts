import { CHALLENGE_STORAGE_KEY } from './two-factor-challenge';

/** The subset of the locale-aware router `logout` needs. */
export interface LogoutRouter {
  replace(href: string): void;
  refresh(): void;
}

/**
 * Ends the session: `POST /auth/logout` (public; on success it clears both cookies), forgets any
 * pending 2FA challenge, then goes to login and drops the router cache so no authenticated RSC
 * payload is reused. Resolves `true` when logged out.
 *
 * On a network error or a non-2xx answer the cookies may still be set, so the user is NOT sent to
 * login as if logged out: it resolves `false` (the caller shows an error toast) and stays put. The
 * pending 2FA challenge is dropped either way (client-only state, worthless after a logout click).
 */
export async function logout(router: LogoutRouter): Promise<boolean> {
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
  if (!ok) return false;
  router.replace('/login');
  router.refresh();
  return true;
}
