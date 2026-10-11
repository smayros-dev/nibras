import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PwnedPasswordClient } from './hibp';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_COMMON' | 'PASSWORD_COMPROMISED' };

const normalise = (s: string): string => s.normalize('NFKC').toLowerCase();

let commonPasswords: ReadonlySet<string> | undefined;

/** SecLists 10 000 most common passwords, loaded once (copied to `dist` as a Nest asset). */
function common(): ReadonlySet<string> {
  commonPasswords ??= new Set(
    readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map(normalise),
  );
  return commonPasswords;
}

/**
 * PRD §8.1.1: 12..256 characters (code points), no composition rules, not among the 10 000 most
 * common (NFKC + lowercase), not found in a breach corpus. The length bound outside 12..256 is
 * reported as `PASSWORD_TOO_SHORT`, the only length code in the stable error-code list.
 */
export class PasswordPolicy {
  constructor(private readonly pwned: PwnedPasswordClient) {}

  async validate(plain: string): Promise<PasswordPolicyResult> {
    const length = [...plain].length;
    if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
      return { ok: false, code: 'PASSWORD_TOO_SHORT' };
    }
    if (common().has(normalise(plain))) return { ok: false, code: 'PASSWORD_TOO_COMMON' };
    if (await this.pwned.isPwned(plain)) return { ok: false, code: 'PASSWORD_COMPROMISED' };
    return { ok: true };
  }
}
