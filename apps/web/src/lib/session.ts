import type { MeUser } from '@tt/contracts';
import { asApiResult, serverApi } from './api';

/**
 * - `ok`: `user` is set;
 * - `unauthenticated`: `401` — no access cookie or an expired one (the browser may still hold a
 *   refresh cookie: the `(app)` layout tries `/auth/resume` once);
 * - `forbidden`: `403` — e.g. a suspended account (a refresh cannot help: straight to login);
 * - `error`: the API answered something unexpected (5xx). A network failure throws.
 */
export type SessionResult =
  | { user: MeUser; status: 'ok' }
  | { user: null; status: 'unauthenticated' | 'forbidden' | 'error' };

/** `GET /me` as the server sees it, with why there is no user. */
export async function getSessionResult(): Promise<SessionResult> {
  const client = await serverApi();
  const result = await client.GET('/me');
  const { data } = asApiResult<MeUser>(result);
  if (data) return { user: data, status: 'ok' };
  if (result.response.status === 401) return { user: null, status: 'unauthenticated' };
  if (result.response.status === 403) return { user: null, status: 'forbidden' };
  return { user: null, status: 'error' };
}

/**
 * The signed-in user as the server sees it: `MeUser` from `GET /me`, or `null` when there is no
 * session, the session was revoked, or the account is suspended (the API returns 401/403).
 */
export async function getSession(): Promise<MeUser | null> {
  return (await getSessionResult()).user;
}
