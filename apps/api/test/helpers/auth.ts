import type { User } from '@tt/db';
import type { Response } from 'supertest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/cookies';
import { SessionService } from '../../src/auth/session.service';
import type { TestAgent, TestContext } from './app';

export interface LoginAsResult {
  /** `Cookie` header value carrying both auth cookies. */
  cookie: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Signs `user` in without going through `POST /auth/login` (no password check, no rate limit, no
 * new-device email): the session is created directly by `SessionService`.
 */
export async function loginAs(
  ctx: Pick<TestContext, 'app'>,
  user: User,
  opts: { remember?: boolean; userAgent?: string; ip?: string } = {},
): Promise<LoginAsResult> {
  const { session, accessToken, refreshToken } = await ctx.app
    .get(SessionService)
    .createSession(user, {
      ip: opts.ip ?? '127.0.0.1',
      userAgent: opts.userAgent ?? 'vitest',
      remember: opts.remember ?? false,
    });
  return {
    cookie: `${ACCESS_COOKIE}=${accessToken}; ${REFRESH_COOKIE}=${refreshToken}`,
    sessionId: session.id,
    accessToken,
    refreshToken,
  };
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** `http` with the `Cookie` header preset on every request. */
export function as(
  http: TestAgent,
  cookie: string,
): Record<Method, (url: string) => ReturnType<TestAgent['get']>> {
  const withCookie = (method: Method) => (url: string) => http[method](url).set('Cookie', cookie);
  return {
    get: withCookie('get'),
    post: withCookie('post'),
    put: withCookie('put'),
    patch: withCookie('patch'),
    delete: withCookie('delete'),
  };
}

/** Raw `Set-Cookie` lines of a response. */
export function setCookies(res: Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (raw === undefined) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

/** The `Set-Cookie` line of cookie `name`, if the response sets it. */
export function setCookieLine(res: Response, name: string): string | undefined {
  return setCookies(res).find((line) => line.startsWith(`${name}=`));
}

/** Value of cookie `name` set by the response (throws when absent). */
export function cookieValue(res: Response, name: string): string {
  const line = setCookieLine(res, name);
  if (!line) throw new Error(`response sets no ${name} cookie`);
  return decodeURIComponent(line.slice(name.length + 1).split(';')[0]!);
}
