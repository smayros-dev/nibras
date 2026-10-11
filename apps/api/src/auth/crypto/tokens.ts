import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token (refresh, email verification, password reset…): 32 random bytes as base64url
 * (43 chars). Only `hash` is stored; `raw` goes to the client once.
 */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

/** SHA-256 hex of a raw token (high-entropy input, so no salt or slow hash is needed). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison. Both sides are SHA-256'd first so the comparison runs over
 * equal-length buffers and leaks neither content nor length.
 */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}
