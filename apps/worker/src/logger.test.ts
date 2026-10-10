import { Writable } from 'node:stream';
import { REDACT_KEYS, redactPaths } from '@tt/contracts';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

function memorySink(): { sink: Writable; text: () => string } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { sink, text: () => chunks.join('') };
}

describe('redactPaths (shared with the API)', () => {
  it('builds key, *.key, *.*.key and *.*.*.key for every shared key', () => {
    const paths = redactPaths();
    expect(paths).toHaveLength(REDACT_KEYS.length * 4);
    expect(paths).toEqual(
      expect.arrayContaining(['password', '*.password', '*.*.password', '*.*.*.password']),
    );
    expect(paths).toEqual(
      expect.arrayContaining(['["set-cookie"]', '*["set-cookie"]', '*.*.*["x-api-key"]']),
    );
  });

  it('compiles in pino', () => {
    expect(() => pino({ redact: redactPaths() })).not.toThrow();
    expect(() => pino({ redact: redactPaths(5) })).not.toThrow();
  });
});

describe('createLogger', () => {
  it('censors secrets nested three levels deep and hyphenated header names', () => {
    const { sink, text } = memorySink();
    const logger = createLogger('info', sink);
    logger.info({
      email: 'a@b.c',
      job: {
        data: { user: { email: 'a@b.c', totpSecret: 'TOTP-SECRET', recoveryCodes: ['rc-1'] } },
      },
      req: { headers: { authorization: 'Bearer t', 'x-api-key': 'key-1' } },
      res: { headers: { 'set-cookie': 'sid=2' } },
      queue: 'notifications',
    });
    const line = text();
    for (const secret of ['a@b.c', 'TOTP-SECRET', 'rc-1', 'Bearer', 'key-1', 'sid=2']) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line)).toMatchObject({ service: 'tt-worker', queue: 'notifications' });
  });
});
