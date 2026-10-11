import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakePwnedClient, HibpClient } from './hibp';
import { PasswordPolicy } from './password-policy';

describe('PasswordPolicy', () => {
  it('policy: too short, too common, compromised, ok', async () => {
    const p = new PasswordPolicy(new FakePwnedClient(['Tr0ub4dor&3xyz99']));
    expect(await p.validate('short')).toEqual({ ok: false, code: 'PASSWORD_TOO_SHORT' });
    expect(await p.validate('password1234')).toEqual({ ok: false, code: 'PASSWORD_TOO_COMMON' });
    expect(await p.validate('Tr0ub4dor&3xyz99')).toEqual({
      ok: false,
      code: 'PASSWORD_COMPROMISED',
    });
    expect(await p.validate('un mot de passe assez long')).toEqual({ ok: true });
  });

  it('counts characters (code points), not UTF-16 units, and enforces the 12..256 bounds', async () => {
    const p = new PasswordPolicy(new FakePwnedClient([]));
    // 11 emoji = 22 UTF-16 units but 11 characters.
    expect(await p.validate('😀'.repeat(11))).toEqual({ ok: false, code: 'PASSWORD_TOO_SHORT' });
    expect(await p.validate('😀'.repeat(12))).toEqual({ ok: true });
    expect(await p.validate('a quiet river '.repeat(18).slice(0, 256))).toEqual({ ok: true });
    expect(await p.validate('a quiet river '.repeat(19).slice(0, 257))).toEqual({
      ok: false,
      code: 'PASSWORD_TOO_SHORT',
    });
  });

  it('matches the common list case-insensitively after NFKC normalisation', async () => {
    const p = new PasswordPolicy(new FakePwnedClient([]));
    expect(await p.validate('PassWord1234')).toEqual({ ok: false, code: 'PASSWORD_TOO_COMMON' });
    // Fullwidth "ｐａｓｓｗｏｒｄ１２３４" folds to "password1234" under NFKC.
    expect(await p.validate('ｐａｓｓｗｏｒｄ１２３４')).toEqual({
      ok: false,
      code: 'PASSWORD_TOO_COMMON',
    });
  });

  it('does not query the breach client for short or common passwords', async () => {
    const client = { isPwned: vi.fn().mockResolvedValue(false) };
    const p = new PasswordPolicy(client);
    await p.validate('short');
    await p.validate('password1234');
    expect(client.isPwned).not.toHaveBeenCalled();
  });
});

describe('HibpClient (k-anonymity)', () => {
  const plain = 'Tr0ub4dor&3xyz99';
  const sha1 = createHash('sha1').update(plain).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  afterEach(() => vi.restoreAllMocks());

  it('sends only the 5-char SHA-1 prefix with Add-Padding and matches the suffix', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(`0000000000000000000000000000000000A:0\r\n${suffix}:42\r\nFFFFF:1`),
      );
    const client = new HibpClient({ fetchImpl, logger: { warn: vi.fn() } });
    expect(await client.isPwned(plain)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(new Headers(init?.headers).get('Add-Padding')).toBe('true');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(plain);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(suffix);
  });

  it('ignores padding entries with a zero count', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(`${suffix}:0\r\n`));
    const client = new HibpClient({ fetchImpl, logger: { warn: vi.fn() } });
    expect(await client.isPwned(plain)).toBe(false);
  });

  it('fails open with a warning on network error, timeout or non-2xx', async () => {
    const warn = vi.fn();
    for (const fetchImpl of [
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError')),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('busy', { status: 503 })),
    ]) {
      expect(await new HibpClient({ fetchImpl, logger: { warn } }).isPwned(plain)).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(plain);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sha1.slice(5));
  });
});
