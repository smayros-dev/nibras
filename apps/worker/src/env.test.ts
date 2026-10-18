import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const base = {
  DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'Nibras <no-reply@nibras.localhost>',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('accepts redis: and rediss: URLs and applies defaults', () => {
    expect(loadEnv({ ...base, REDIS_URL: 'redis://localhost:6379/8' })).toMatchObject({
      REDIS_URL: 'redis://localhost:6379/8',
      WORKER_PORT: 3002,
      LOG_LEVEL: 'info',
    });
    expect(loadEnv({ ...base, REDIS_URL: 'rediss://host:6380' }).REDIS_URL).toBe(
      'rediss://host:6380',
    );
  });

  it('requires the email settings (SMTP_URL, EMAIL_FROM, WEB_ORIGIN)', () => {
    const { SMTP_URL: _s, EMAIL_FROM: _e, WEB_ORIGIN: _w, ...rest } = base;
    let message = '';
    try {
      loadEnv({ ...rest, REDIS_URL: 'redis://localhost:6379' });
    } catch (err) {
      message = (err as Error).message;
    }
    for (const name of ['SMTP_URL', 'EMAIL_FROM', 'WEB_ORIGIN']) expect(message).toContain(name);
  });

  it('rejects REDIS_URL with another scheme', () => {
    expect(() => loadEnv({ ...base, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
  });
});
