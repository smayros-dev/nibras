import { Writable } from 'node:stream';
import { REDACT_KEYS, REDACT_SCOPED_PATHS, redactPaths } from '@nibras/contracts';
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
    expect(paths).toHaveLength(REDACT_KEYS.length * 4 + REDACT_SCOPED_PATHS.length);
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
    expect(JSON.parse(line)).toMatchObject({ service: 'nibras-worker', queue: 'notifications' });
  });

  it('keeps err.code readable but censors otpCode and body.code', () => {
    const { sink, text } = memorySink();
    const log = createLogger('info', sink);
    const lastLine = () => JSON.parse(text().trimEnd().split('\n').at(-1) ?? '{}');
    log.info(
      {
        err: { code: 'P1001' },
        otpCode: '123456',
        req: { body: { code: '654321' } },
        job: { data: { code: 'abc' } },
      },
      'x',
    );
    const line = lastLine();
    expect(line.err.code).toBe('P1001');
    expect(line.otpCode).toBe('[REDACTED]');
    expect(line.req.body.code).toBe('[REDACTED]');
    expect(line.job.data.code).toBe('[REDACTED]');
  });
});
