import { describe, expect, it } from 'vitest';
import { parseChallenge, serializeChallenge } from './two-factor-challenge';

describe('2FA challenge storage', () => {
  it('round-trips token, remember and a sanitized next', () => {
    const raw = serializeChallenge({ challengeToken: 'tok', remember: true, next: '/fr/app/w/1' });
    expect(parseChallenge(raw)).toEqual({
      challengeToken: 'tok',
      remember: true,
      next: '/app/w/1',
    });
  });

  it('tolerates the SP1 plain-string format', () => {
    expect(parseChallenge('abc.def')).toEqual({
      challengeToken: 'abc.def',
      remember: false,
      next: null,
    });
  });

  it('drops an unsafe next and rejects malformed payloads', () => {
    expect(
      parseChallenge(JSON.stringify({ challengeToken: 't', next: '//evil' }))?.next,
    ).toBeNull();
    expect(parseChallenge(JSON.stringify({ remember: true }))).toBeNull();
    expect(parseChallenge(null)).toBeNull();
    expect(parseChallenge('')).toBeNull();
  });
});
