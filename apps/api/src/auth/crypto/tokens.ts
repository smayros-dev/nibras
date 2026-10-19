import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Opaque tokens (refresh, email verification, password reset, SP2 invitation and guardian links):
 * 32 random bytes as base64url (43 chars), stored as their SHA-256 hex. One implementation, shared
 * with the worker through `@nibras/contracts` (`generateOpaqueToken` / `hashOpaqueToken`): only
 * `hash` is stored, `raw` goes to the client once.
 */
export {
  generateOpaqueToken as generateToken,
  hashOpaqueToken as hashToken,
} from '@nibras/contracts';

/**
 * Constant-time string comparison. Both sides are SHA-256'd first so the comparison runs over
 * equal-length buffers and leaks neither content nor length.
 */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}
