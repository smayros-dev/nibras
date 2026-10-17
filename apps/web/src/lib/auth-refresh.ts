/**
 * Session resilience (audit #1). The access cookie lives 15 minutes; the refresh cookie (path
 * `/api/v1/auth`) rotates on every `POST /auth/refresh`, and the API treats a spent refresh token
 * presented after a rotation committed as a replay: every session of the user is revoked
 * (`session.service.ts`, AC-AUTH-04). So refreshes must never overlap with a stale cookie:
 *
 * - within a tab, concurrent callers share one in-flight refresh (`inflight`);
 * - across tabs, the refresh runs under the Web Lock `tt-auth-refresh`, and a tab that waited
 *   for the lock while another tab refreshed reuses that result instead of rotating again (the
 *   shared `localStorage` timestamp `tt.auth.refreshedAt`);
 * - a call is retried at most once, `/auth/refresh` itself (and login, logout, 2FA) never.
 *
 * Only the browser refreshes: the refresh cookie's path keeps it away from page requests, so
 * server components never rotate (a server navigation with an expired access cookie goes
 * through `/auth/resume`).
 */

export const SESSION_EXPIRED_EVENT = 'tt:session-expired';
/** Loop guard set by `/auth/resume`: a second unauthenticated hit goes to login instead. */
export const RESUME_COOKIE = 'tt_resume';
/** Proactive refresh period, under the 15-minute access token lifetime. */
export const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

const REFRESH_URL = '/api/v1/auth/refresh';
const LOCK_NAME = 'tt-auth-refresh';
const REFRESHED_AT_KEY = 'tt.auth.refreshedAt';
/** Calls whose 401 is an answer, not an expired session: never refreshed nor retried. */
const NO_RETRY_PATH = /^\/api\/v1\/auth\/(login|refresh|logout|2fa\/)/;
/** 401 codes that mean "access token missing/expired"; others (wrong password…) are final. */
const SESSION_CODES = new Set(['UNAUTHENTICATED']);

let inflight: Promise<boolean> | null = null;

/** When any tab of this browser last refreshed successfully (epoch ms, 0 when unknown). */
export function lastRefreshAt(): number {
  try {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(REFRESHED_AT_KEY);
    const at = raw === null ? 0 : Number(raw);
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function markRefreshed(at: number): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(REFRESHED_AT_KEY, String(at));
  } catch {
    // Storage blocked: the cross-tab shortcut is an optimisation only.
  }
}

async function postRefresh(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(REFRESH_URL, { method: 'POST', credentials: 'same-origin' });
    if (res.ok) markRefreshed(Date.now());
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshAcrossTabs(fetchImpl: typeof fetch): Promise<boolean> {
  const requestedAt = Date.now();
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return postRefresh(fetchImpl);
  return locks.request(LOCK_NAME, async () => {
    // Another tab rotated while we waited: the cookie jar already holds its new tokens.
    if (lastRefreshAt() >= requestedAt) return true;
    return postRefresh(fetchImpl);
  });
}

/** `POST /auth/refresh`, single-flight (per tab and across tabs); resolves `res.ok`. */
export function refreshSession(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (inflight) return inflight;
  const run = refreshAcrossTabs(fetchImpl).finally(() => {
    inflight = null;
  });
  inflight = run;
  return run;
}

function pathOf(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

/** Whether a 401 means the access token is missing or expired (unknown bodies count). */
async function isSessionExpiry(res: Response): Promise<boolean> {
  try {
    const body: unknown = await res.clone().json();
    const code = (body as { code?: unknown } | null)?.code;
    return typeof code !== 'string' || SESSION_CODES.has(code);
  } catch {
    return true;
  }
}

/** A body that can be sent a second time (a one-shot stream cannot). */
function isReplayable(init: RequestInit | undefined): boolean {
  const body = init?.body;
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

/**
 * `fetch` that answers a session-expiry 401 with one shared refresh and one retry of the original
 * request (same body: a `Request` input is cloned before the first send). When the refresh fails
 * it dispatches {@link SESSION_EXPIRED_EVENT} on `window` and returns the original 401.
 */
export function createRefreshingFetch(base: typeof fetch = fetch): typeof fetch {
  const call = (input: RequestInfo | URL, init?: RequestInit) => base(input, init);
  return async (input, init) => {
    const retryable = !NO_RETRY_PATH.test(pathOf(input)) && isReplayable(init);
    const spare = retryable && input instanceof Request ? input.clone() : input;
    const res = await call(input, init);
    if (res.status !== 401 || !retryable || !(await isSessionExpiry(res))) return res;
    if (await refreshSession(base)) return call(spare, init);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    return res;
  };
}
