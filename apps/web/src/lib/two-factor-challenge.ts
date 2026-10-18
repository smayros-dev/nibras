import { sanitizeNext } from './sanitize-next';

/** `sessionStorage` key of the pending 2FA login challenge (JSON since SP1.5). */
export const CHALLENGE_STORAGE_KEY = 'nibras.2fa.challenge';

export interface TwoFactorChallenge {
  challengeToken: string;
  /** "Se souvenir de cet appareil" as ticked on the login form. */
  remember: boolean;
  /** Sanitized locale-less deep link to open after the second factor. */
  next: string | null;
}

export function serializeChallenge(challenge: TwoFactorChallenge): string {
  return JSON.stringify({ ...challenge, next: sanitizeNext(challenge.next) });
}

/**
 * The stored challenge, or `null` when there is none. Tolerates the SP1 format (the raw token as
 * a plain string) and sanitizes `next` again: storage is not a trusted source.
 */
export function parseChallenge(raw: string | null): TwoFactorChallenge | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { challengeToken: raw, remember: false, next: null };
  }
  if (typeof value === 'string')
    return value ? { challengeToken: value, remember: false, next: null } : null;
  if (typeof value !== 'object' || value === null) return null;
  const { challengeToken, remember, next } = value as Record<string, unknown>;
  if (typeof challengeToken !== 'string' || challengeToken === '') return null;
  return {
    challengeToken,
    remember: remember === true,
    next: typeof next === 'string' ? sanitizeNext(next) : null,
  };
}
