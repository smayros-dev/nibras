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

  describe('APP_ENV and deployable environments', () => {
    const redis = { REDIS_URL: 'redis://localhost:6379' };
    const staging = {
      ...base,
      ...redis,
      APP_ENV: 'staging',
      DATABASE_URL_SYSTEM: 'postgresql://app_system:other-random@postgres:5432/nibras',
      WEB_ORIGIN: 'https://staging.example.com',
    };

    it('defaults APP_ENV to development and rejects unknown tiers', () => {
      expect(loadEnv({ ...base, ...redis }).APP_ENV).toBe('development');
      expect(loadEnv(staging).APP_ENV).toBe('staging');
      expect(loadEnv({ ...staging, APP_ENV: 'production' }).APP_ENV).toBe('production');
      expect(() => loadEnv({ ...base, ...redis, APP_ENV: 'prod' })).toThrow(/APP_ENV/);
    });

    it.each([
      ['DATABASE_URL_SYSTEM', 'postgresql://app_system:app@postgres:5432/nibras'],
      ['WEB_ORIGIN', 'http://staging.example.com'],
    ])('rejects %s=%s on staging and production, accepts it in development', (key, value) => {
      expect(() => loadEnv({ ...staging, [key]: value })).toThrow(/Invalid worker environment/);
      expect(() => loadEnv({ ...staging, [key]: value })).toThrow(new RegExp(key));
      expect(() => loadEnv({ ...staging, APP_ENV: 'production', [key]: value })).toThrow(
        new RegExp(key),
      );
      expect(() => loadEnv({ ...staging, APP_ENV: 'development', [key]: value })).not.toThrow();
      expect(() => loadEnv({ ...base, ...redis, [key]: value })).not.toThrow();
    });
  });
});
