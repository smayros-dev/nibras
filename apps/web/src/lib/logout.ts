import { CHALLENGE_STORAGE_KEY } from './two-factor-challenge';

/** The subset of the locale-aware router `logout` needs. */
export interface LogoutRouter {
  replace(href: string): void;
  refresh(): void;
}

/**
 * Ends the session: `POST /auth/logout` (public, always clears both cookies; errors are ignored —
 * the user is leaving either way), forgets any pending 2FA challenge, then goes to login and
 * drops the router cache so no authenticated RSC payload is reused.
 */
export async function logout(router: LogoutRouter): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Network error: the cookies stay, but the UI still leaves the app.
  }
  try {
    sessionStorage.removeItem(CHALLENGE_STORAGE_KEY);
  } catch {
    // Storage blocked.
  }
  router.replace('/login');
  router.refresh();
}
