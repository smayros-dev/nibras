import { randomBytes } from 'node:crypto';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@nibras/contracts';

/**
 * A new group invite code: `INVITE_CODE_LENGTH` (8) characters of the 32-symbol
 * `INVITE_CODE_ALPHABET` (no `0 O 1 I`), one random byte per character taken modulo 32 — 256 is a
 * multiple of 32, so every symbol is equally likely (≈ 1.1 × 10¹² codes). Uniqueness is the
 * database's (`invite_link_code_key`): callers retry on a `P2002`.
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (const b of bytes) code += INVITE_CODE_ALPHABET[b % INVITE_CODE_ALPHABET.length];
  return code;
}
