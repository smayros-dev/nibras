import { describe, expect, it } from 'vitest';
import { hashPassword, normalisePassword, verifyPassword } from './password';

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

  it('NFKC-normalises before hashing and verifying (NFC and NFD forms are the same password)', async () => {
    const nfc = 'mot de passe déjà vu';
    const nfd = 'mot de passe déjà vu';
    expect(nfd).not.toBe(nfc);
    expect(nfd.normalize('NFC')).toBe(nfc);
    expect(await verifyPassword(await hashPassword(nfc), nfd)).toBe(true);
    expect(await verifyPassword(await hashPassword(nfd), nfc)).toBe(true);
  });

  it('normalisePassword applies NFKC only (no trimming, no case folding)', () => {
    // Fullwidth P (U+FF30) and the fi ligature (U+FB01) fold; spaces and case are kept.
    expect(normalisePassword(' Ｐassﬁle ')).toBe(' Passfile ');
    expect(normalisePassword('é')).toBe('é');
  });
});
