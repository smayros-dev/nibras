'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '../i18n/navigation';
import {
  lastRefreshAt,
  refreshSession,
  REFRESH_INTERVAL_MS,
  SESSION_EXPIRED_EVENT,
} from '../lib/auth-refresh';

/** How often the refresher checks whether a proactive refresh is due. */
export const REFRESH_CHECK_MS = 60 * 1000;

/**
 * Keeps the 15-minute access cookie fresh while the app is open and sends the user to login when
 * a refresh fails. A refresh is due once {@link REFRESH_INTERVAL_MS} has passed since the last
 * successful one in ANY tab (shared timestamp) or since this frame mounted (the server just
 * accepted the access cookie), so several open tabs do not each rotate the refresh token. A failed
 * proactive refresh (while online) dispatches {@link SESSION_EXPIRED_EVENT}. Renders nothing.
 */
export function AuthRefresher() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const mountedAt = Date.now();
    const maybeRefresh = () => {
      if (Date.now() - Math.max(lastRefreshAt(), mountedAt) >= REFRESH_INTERVAL_MS) {
        void refreshSession().then((ok) => {
          // A refused refresh ends the session; offline, the cookies may still be good once the
          // network is back (the next due check or client call retries).
          if (!ok && navigator.onLine !== false) {
            window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          }
        });
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };
    const timer = window.setInterval(maybeRefresh, REFRESH_CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    let redirected = false;
    const onExpired = () => {
      if (redirected) return;
      redirected = true;
      router.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  return null;
}
