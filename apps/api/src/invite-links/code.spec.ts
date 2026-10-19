import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, normaliseInviteCode } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { generateInviteCode } from './code';

describe('generateInviteCode', () => {
  it('returns 8 characters of the 32-symbol alphabet that normaliseInviteCode accepts as typed', () => {
    const shape = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);
    const codes = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(shape);
      expect(normaliseInviteCode(` ${code.toLowerCase()} `)).toBe(code);
      codes.add(code);
    }
    // ≈ 1.1 × 10¹² codes: 2000 draws never collide in practice.
    expect(codes.size).toBe(2000);
  });

  it('draws every symbol of the alphabet and never an ambiguous one (0 O 1 I)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) for (const ch of generateInviteCode()) seen.add(ch);
    expect([...seen].sort().join('')).toBe([...INVITE_CODE_ALPHABET].sort().join(''));
    expect([...seen].some((ch) => '0O1I'.includes(ch))).toBe(false);
  });
});
