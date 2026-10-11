import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PwnedPasswordClient } from './hibp';
import { normalisePassword } from './password';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_COMMON' | 'PASSWORD_COMPROMISED' };

/** Common-list key: the NFKC form, lower-cased (the case folding applies to this lookup only). */
const commonKey = (s: string): string => normalisePassword(s).toLowerCase();

let commonPasswords: ReadonlySet<string> | undefined;

/**
 * 10 000 most common passwords, loaded once (copied to `dist` as a Nest asset).
 * Source: SecLists (https://github.com/danielmiessler/SecLists), MIT licence,
 * `Passwords/Common-Credentials/Pwdb_top-10000.txt`, byte-identical to the file at commit
 * 12274c98fdebe98c7a7284914436a472ed469aed (fetched 2026-10-11).
 */
function common(): ReadonlySet<string> {
  commonPasswords ??= new Set(
    readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map(commonKey),
  );
  return commonPasswords;
}

/**
 * PRD §8.1.1: 12..256 characters (code points of the NFKC form), no composition rules, not among
 * the 10 000 most common (NFKC + lowercase), not found in a breach corpus (NFKC form). A length
 * outside 12..256 is reported as `PASSWORD_TOO_SHORT`, the only length code in the stable
 * error-code list.
 */
export class PasswordPolicy {
  constructor(private readonly pwned: PwnedPasswordClient) {}

  async validate(plain: string): Promise<PasswordPolicyResult> {
    const length = [...normalisePassword(plain)].length;
    if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
      return { ok: false, code: 'PASSWORD_TOO_SHORT' };
    }
    if (common().has(commonKey(plain))) return { ok: false, code: 'PASSWORD_TOO_COMMON' };
    if (await this.pwned.isPwned(plain)) return { ok: false, code: 'PASSWORD_COMPROMISED' };
    return { ok: true };
  }
}
