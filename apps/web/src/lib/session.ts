import type { MeUser } from '@tt/contracts';
import { asApiResult, serverApi } from './api';

/**
 * The signed-in user as the server sees it: `MeUser` from `GET /me`, or `null` when there is no
 * session, the session was revoked, or the account is suspended (the API returns 401/403).
 */
export async function getSession(): Promise<MeUser | null> {
  const client = await serverApi();
  const { data } = asApiResult<MeUser>(await client.GET('/me'));
  return data ?? null;
}
