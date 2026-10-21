// Server entry only (`node:crypto`): never exported by `@nibras/contracts/web`.
import { createHash, randomBytes } from 'node:crypto';

/** Length of a raw opaque token: 32 random bytes as base64url. */
export const OPAQUE_TOKEN_RAW_LENGTH = 43;

/** SHA-256 hex of a raw token (high-entropy input, so no salt or slow hash is needed). */
export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Opaque link token (invitation, guardian consent, guardian page): 32 random bytes as base64url.
 * Only `hash` is stored; `raw` goes into the emailed link once. Identical to the API's
 * `generateToken` (`apps/api/src/auth/crypto/tokens.ts`), and shared with the worker.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}
