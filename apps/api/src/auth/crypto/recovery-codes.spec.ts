import { describe, expect, it } from 'vitest';
import {
  findRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './recovery-codes';

describe('recovery codes', () => {
  it('generates 10 distinct xxxxx-xxxxx base32 codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });

  it('finds the matching argon2id hash; unknown or malformed codes are -1', async () => {
    const [a, b] = generateRecoveryCodes() as [string, string];
    const hashes = [await hashRecoveryCode(a), await hashRecoveryCode(b)];
    expect(hashes[0]).toMatch(/^\$argon2id\$/);
    expect(await findRecoveryCode(hashes, b)).toBe(1);
    expect(await findRecoveryCode(hashes, a)).toBe(0);
    expect(await findRecoveryCode(hashes, 'aaaaa-aaaaa')).toBe(-1);
    expect(await findRecoveryCode(hashes, a.toUpperCase())).toBe(-1);
    expect(await findRecoveryCode(['not-a-hash'], a)).toBe(-1);
  });
});
