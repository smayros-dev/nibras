import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('argon2id hash verifies and is salted', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'nope')).toBe(false);
    expect(h).not.toBe(await hashPassword('correct horse battery staple'));
  });

  it('uses 64 MiB memory, 3 iterations, parallelism 1', async () => {
    expect(await hashPassword('correct horse battery staple')).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/,
    );
  });

  it('returns false (does not throw) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
