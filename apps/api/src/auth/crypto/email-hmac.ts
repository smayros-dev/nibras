import { createHmac, hkdfSync } from 'node:crypto';
import { env } from '../../config/env';

let key: Buffer | undefined;

/**
 * HMAC-SHA256 (hex) of a normalised (trimmed, lower-cased) email, for audit entries about an
 * email that matches no account. A plain SHA-256 of an email is reversible by dictionary; the key
 * is derived from `JWT_SECRET` with HKDF (own `info`, so it is never the signing key itself).
 */
// The HKDF salt `tt-audit` predates the rename to Nibras and is frozen on purpose: changing it would
// change every HMAC, so new audit entries would no longer match those already stored.
export function emailHmac(email: string): string {
  key ??= Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'tt-audit', 'audit-email-hmac-v1', 32));
  return createHmac('sha256', key).update(email.trim().toLowerCase(), 'utf8').digest('hex');
}
