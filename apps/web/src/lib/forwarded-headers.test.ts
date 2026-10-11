import { describe, expect, it } from 'vitest';
import { forwardHeaders } from './forwarded-headers';

describe('forwardHeaders', () => {
  it('forwards cookie, the client address chain, the request id and accept-language', () => {
    const incoming = new Headers({
      cookie: 'sid=1',
      'x-forwarded-for': '203.0.113.7, 198.51.100.2',
      'x-request-id': 'req-42',
      'accept-language': 'ar-TN,fr;q=0.8',
      host: 'staging.example.com',
      authorization: 'Bearer t',
    });
    const out = forwardHeaders(incoming, new Headers({ accept: 'application/json' }));
    expect(Object.fromEntries(out)).toEqual({
      accept: 'application/json',
      cookie: 'sid=1',
      'x-forwarded-for': '203.0.113.7, 198.51.100.2',
      'x-request-id': 'req-42',
      'accept-language': 'ar-TN,fr;q=0.8',
    });
  });

  it('leaves absent headers unset', () => {
    const out = forwardHeaders(new Headers(), new Headers());
    expect([...out.keys()]).toEqual([]);
  });
});
