import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, safeEqual } from './tokens';

describe('opaque tokens', () => {
  it('tokens: 43-char base64url raw, 64-hex hash, safeEqual constant-time API', () => {
    const t = generateToken();
    expect(t.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(createHash('sha256').update(t.raw).digest('hex'));
    expect(hashToken(t.raw)).toBe(t.hash);
    expect(generateToken().raw).not.toBe(t.raw);

    expect(safeEqual(t.hash, hashToken(t.raw))).toBe(true);
    expect(safeEqual(t.hash, hashToken(generateToken().raw))).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('é', 'e')).toBe(false);
  });
});
