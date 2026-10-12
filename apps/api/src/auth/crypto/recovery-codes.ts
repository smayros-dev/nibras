import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/** PRD §8.1.2: 10 recovery codes per enrolment. */
export const RECOVERY_CODE_COUNT = 10;

/** Lower-case RFC 4648 base32 alphabet (32 symbols: `byte % 32` is unbiased). */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const FORMAT = /^[a-z2-7]{5}-[a-z2-7]{5}$/;

/**
 * argon2id at the OWASP minimum (19 MiB, 2 passes): a code carries 50 random bits, so the hash
 * only has to resist an offline attack on a leaked row, not a dictionary. Cheaper than the
 * password profile because up to 10 hashes are computed at enrolment and verified per attempt.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

/** `xxxxx-xxxxx` from the base32 alphabet (50 bits of entropy). */
export function generateRecoveryCode(): string {
  const chars = Array.from(randomBytes(10), (b) => BASE32[b % 32]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** {@link RECOVERY_CODE_COUNT} distinct codes. */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateRecoveryCode());
  return [...codes];
}

export function hashRecoveryCode(code: string): Promise<string> {
  return argon2.hash(code, ARGON2_OPTIONS);
}

/**
 * Index in `hashes` of the hash matching `code` (already trimmed and lower-cased), or `-1`.
 * Malformed input never reaches argon2. Every hash is checked (no early exit), so the timing does
 * not reveal which code matched.
 */
export async function findRecoveryCode(hashes: readonly string[], code: string): Promise<number> {
  if (!FORMAT.test(code)) return -1;
  let found = -1;
  for (let i = 0; i < hashes.length; i++) {
    let ok = false;
    try {
      ok = await argon2.verify(hashes[i]!, code);
    } catch {
      ok = false;
    }
    if (ok && found === -1) found = i;
  }
  return found;
}
