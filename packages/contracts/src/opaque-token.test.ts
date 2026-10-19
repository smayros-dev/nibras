import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OPAQUE_TOKEN_RAW_LENGTH, generateOpaqueToken, hashOpaqueToken } from './opaque-token';

describe('opaque tokens', () => {
  it('raw is 43 base64url chars, hash is its sha256 hex, two calls differ', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.raw).toHaveLength(OPAQUE_TOKEN_RAW_LENGTH);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(a.raw)).toBe(a.hash);
    expect(a.hash).toBe(createHash('sha256').update(a.raw, 'utf8').digest('hex'));
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});
