import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');

/** Flips the low bit of the hex digit at `index` of the payload (after `v1.`). */
function flipHexDigit(sealed: string, index: number): string {
  const i = 'v1.'.length + (index < 0 ? sealed.length - 'v1.'.length + index : index);
  const flipped = (parseInt(sealed[i]!, 16) ^ 1).toString(16);
  return sealed.slice(0, i) + flipped + sealed.slice(i + 1);
}

describe('SecretBox', () => {
  it('secret box round-trips and rejects tampering', () => {
    const b = new SecretBox(KEY);
    const s = b.seal('JBSWY3DPEHPK3PXP');
    expect(b.open(s)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => b.open(s.slice(0, -2) + 'AA')).toThrow();
  });

  it('rejects a single flipped bit in the nonce, the ciphertext or the tag', () => {
    const b = new SecretBox(KEY);
    const s = b.seal('JBSWY3DPEHPK3PXP');
    // Layout (hex): 24 nonce digits, 32 ciphertext digits, 32 tag digits.
    for (const index of [0, 23, 24, 55, 56, -1]) {
      expect(() => b.open(flipHexDigit(s, index))).toThrow();
    }
  });

  it('is versioned, uses a fresh nonce per seal and never embeds the plaintext', () => {
    const b = new SecretBox(KEY);
    const s1 = b.seal('JBSWY3DPEHPK3PXP');
    const s2 = b.seal('JBSWY3DPEHPK3PXP');
    expect(s1).toMatch(/^v1\.[0-9a-f]+$/);
    expect(s1).toHaveLength('v1.'.length + 2 * (12 + 16 + 16));
    expect(s1.slice(3, 27)).not.toBe(s2.slice(3, 27));
    expect(s1).not.toBe(s2);
    expect(s1).not.toContain('JBSWY3DPEHPK3PXP');
    expect(b.open(s2)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('round-trips the empty string and non-ASCII text', () => {
    const b = new SecretBox(KEY);
    expect(b.open(b.seal(''))).toBe('');
    expect(b.open(b.seal('clé secrète — مفتاح'))).toBe('clé secrète — مفتاح');
  });

  it('rejects another key, an unknown version and malformed or truncated input', () => {
    const s = new SecretBox(KEY).seal('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox(OTHER_KEY).open(s)).toThrow();
    expect(() => new SecretBox(KEY).open(s.replace(/^v1\./, 'v2.'))).toThrow();
    expect(() => new SecretBox(KEY).open(s.toUpperCase().replace(/^V1/, 'v1'))).toThrow();
    expect(() => new SecretBox(KEY).open(s.slice(0, -1))).toThrow();
    expect(() => new SecretBox(KEY).open('v1.abcd')).toThrow();
    expect(() => new SecretBox(KEY).open('garbage')).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new SecretBox('')).toThrow(/32 bytes/);
  });

  it('does not leak the key or plaintext in error messages', () => {
    const s = new SecretBox(KEY).seal('JBSWY3DPEHPK3PXP');
    let error: unknown;
    try {
      new SecretBox(OTHER_KEY).open(s);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const text = `${String(error)} ${(error as Error).stack ?? ''}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(OTHER_KEY);
    expect(text).not.toContain('JBSWY3DPEHPK3PXP');
  });
});
