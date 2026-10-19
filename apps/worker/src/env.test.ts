import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const base = {
  DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'Nibras <no-reply@nibras.localhost>',
  WEB_ORIGIN: 'http://localhost:3000',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_BUCKET: 'nibras-dev',
};

/** The Cloudflare subset the worker needs (getAsset, delete): no webhook secret, no signing key. */
const cloudflare = {
  VIDEO_PROVIDER: 'cloudflare_stream',
  CLOUDFLARE_ACCOUNT_ID: '023e105f4ecef8ad9ca31a8372d0c353',
  CLOUDFLARE_STREAM_API_TOKEN: 'Yq7-Stream-Edit-Token_4f9c2a',
};

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return '';
}

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
      S3_ENDPOINT: 'http://minio:9000',
      S3_ACCESS_KEY: 'nibras-staging',
      S3_SECRET_KEY: 'k3Q9-random_Secret-from-openssl-7f2b',
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
      ['S3_SECRET_KEY', 'minioadmin'],
      ['CLOUDFLARE_STREAM_API_TOKEN', 'change-me'],
    ])('rejects %s=%s on staging and production, accepts it in development', (key, value) => {
      // Cloudflare secrets come with VIDEO_PROVIDER=cloudflare_stream (which requires them).
      const deployed = key.startsWith('CLOUDFLARE_') ? { ...staging, ...cloudflare } : staging;
      const local = key.startsWith('CLOUDFLARE_')
        ? { ...base, ...redis, ...cloudflare }
        : { ...base, ...redis };
      expect(() => loadEnv({ ...deployed, [key]: value })).toThrow(/Invalid worker environment/);
      expect(() => loadEnv({ ...deployed, [key]: value })).toThrow(new RegExp(key));
      expect(() => loadEnv({ ...deployed, APP_ENV: 'production', [key]: value })).toThrow(
        new RegExp(key),
      );
      expect(() => loadEnv({ ...deployed, APP_ENV: 'development', [key]: value })).not.toThrow();
      expect(() => loadEnv({ ...local, [key]: value })).not.toThrow();
    });
  });
  describe('SP3 object storage and video provider', () => {
    const redis = { REDIS_URL: 'redis://localhost:6379' };

    it('requires S3_*, defaults VIDEO_PROVIDER to s3, region us-east-1 and path-style URLs', () => {
      const env = loadEnv({ ...base, ...redis });
      expect(env).toMatchObject({
        S3_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: true,
        S3_BUCKET: 'nibras-dev',
        VIDEO_PROVIDER: 's3',
      });
      expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
      const {
        S3_ENDPOINT: _e,
        S3_ACCESS_KEY: _a,
        S3_SECRET_KEY: _s,
        S3_BUCKET: _b,
        ...rest
      } = base;
      const message = errorOf(() => loadEnv({ ...rest, ...redis }));
      for (const name of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
        expect(message).toContain(name);
      }
      expect(() => loadEnv({ ...base, ...redis, S3_BUCKET: 'Bad_Bucket' })).toThrow(/S3_BUCKET/);
    });

    it('cloudflare_stream needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN only', () => {
      const message = errorOf(() =>
        loadEnv({ ...base, ...redis, VIDEO_PROVIDER: 'cloudflare_stream' }),
      );
      expect(message).toContain('CLOUDFLARE_ACCOUNT_ID');
      expect(message).toContain('CLOUDFLARE_STREAM_API_TOKEN');
      expect(message).not.toContain('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
      expect(message).not.toContain('CLOUDFLARE_STREAM_SIGNING_KEY');
      expect(loadEnv({ ...base, ...redis, ...cloudflare }).VIDEO_PROVIDER).toBe(
        'cloudflare_stream',
      );
      // Empty (compose `${VAR:-}`) counts as missing.
      expect(() =>
        loadEnv({ ...base, ...redis, ...cloudflare, CLOUDFLARE_ACCOUNT_ID: '' }),
      ).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    });
  });
});
