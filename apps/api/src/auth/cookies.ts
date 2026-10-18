import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../app.setup';
import { env } from '../config/env';
import { ACCESS_TTL_S } from './jwt.service';

export const ACCESS_COOKIE = 'nibras_access';
export const REFRESH_COOKIE = 'nibras_refresh';
/** The refresh token only travels to the auth routes (refresh, logout). */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;
/** PRD §8.1.2: rotating refresh token, 30 days. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** PRD §8.1.2: `httpOnly; Secure; SameSite=Lax` (`Secure` follows `COOKIE_SECURE`). */
export function authCookieOptions(secure = env.COOKIE_SECURE): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax' };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** "Se souvenir de cet appareil": persistent refresh cookie. */
  remember: boolean;
  /** Server-side end of the session (absolute, set at sign-in). */
  expiresAt: Date;
}

/**
 * Sets `nibras_access` (path `/`, 15 min) and `nibras_refresh` (path `/api/v1/auth`). The refresh cookie
 * is persistent only when `remember`, and then never outlives the session: Max-Age is the time
 * left until `expiresAt` (30 days at sign-in), rounded up to a whole second. Otherwise it is a
 * browser-session cookie.
 */
export function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  const base = authCookieOptions();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: ACCESS_TTL_S * 1000,
  });
  const left = Math.ceil((tokens.expiresAt.getTime() - Date.now()) / 1000) * 1000;
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    ...(tokens.remember && { maxAge: Math.max(0, Math.min(REFRESH_TTL_MS, left)) }),
  });
}

/** Expires both auth cookies (same name, path and flags as when they were set). */
export function clearAuthCookies(res: Response): void {
  const base = authCookieOptions();
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}

/** The access token of a request: `Authorization: Bearer …` first, else the `nibras_access` cookie. */
export function accessTokenOf(req: Request): string | undefined {
  const header = req.get('authorization');
  if (header !== undefined) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return m?.[1];
  }
  return cookieOf(req, ACCESS_COOKIE);
}

/** A cookie value as a non-empty string (cookie-parser may yield JSON-decoded objects). */
export function cookieOf(req: Request, name: string): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
