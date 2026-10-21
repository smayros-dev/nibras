import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app_user:app@localhost:5432/nibras',
  DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras',
  REDIS_URL: 'redis://localhost:6379/0',
  WEB_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'info',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'Nibras <no-reply@nibras.localhost>',
  JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef',
  // 'test-only-totp-key-32-bytes-long' (32 bytes)
  TOTP_ENCRYPTION_KEY: Buffer.from('test-only-totp-key-32-bytes-long').toString('base64'),
  // SP3 object storage: the local MinIO (root credentials, refused outside development).
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_BUCKET: 'nibras-dev',
};

/** Every CLOUDFLARE_* variable `VIDEO_PROVIDER=cloudflare_stream` needs (non-placeholder values). */
const cloudflare = {
  VIDEO_PROVIDER: 'cloudflare_stream',
  CLOUDFLARE_ACCOUNT_ID: '023e105f4ecef8ad9ca31a8372d0c353',
  CLOUDFLARE_STREAM_API_TOKEN: 'Yq7-Stream-Edit-Token_4f9c2a',
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'Wh7-Secret_from-Cloudflare-9d1e',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: '8f926b2b01f383510284a74ed8a1d2a7',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: 'LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQo=',
  CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN: 'customer-abc123.cloudflarestream.com',
};
const CLOUDFLARE_KEYS = Object.keys(cloudflare).filter((k) => k.startsWith('CLOUDFLARE_'));

/** A well-formed staging env: real-looking secrets, no init.sql password, https, secure cookies. */
const staging = {
  ...valid,
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  WEB_ORIGIN: 'https://staging.example.com',
  DATABASE_URL: 'postgresql://app_user:s3cr3t-random@postgres:5432/nibras',
  DATABASE_URL_SYSTEM: 'postgresql://app_system:other-random@postgres:5432/nibras',
  JWT_SECRET: 'Qm9vaywgY2F0cywgdGVhIGFuZCAzMiByYW5kb20gYnl0ZXM=',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 0x5a).toString('base64'),
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://s3.staging.example.com',
  S3_ACCESS_KEY: 'nibras-staging',
  S3_SECRET_KEY: 'k3Q9-random_Secret-from-openssl-7f2b',
  S3_BUCKET: 'nibras-staging',
};

describe('EnvSchema', () => {
  it('parses a valid environment and defaults PORT to 3001', () => {
    const env = EnvSchema.parse(valid);
    expect(env.PORT).toBe(3001);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('coerces PORT and treats an empty OTLP endpoint as unset', () => {
    const env = EnvSchema.parse({ ...valid, PORT: '4000', OTEL_EXPORTER_OTLP_ENDPOINT: '' });
    expect(env.PORT).toBe(4000);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('parses without DATABASE_URL_SYSTEM (never set on the api service, SP1.6 F3)', () => {
    const { DATABASE_URL_SYSTEM: _omit, ...rest } = valid;
    expect(EnvSchema.parse(rest).DATABASE_URL_SYSTEM).toBeUndefined();
    // Staging/production too: the BYPASSRLS URL is only checked when present.
    const { DATABASE_URL_SYSTEM: _omitStaging, ...stagingRest } = staging;
    expect(EnvSchema.parse(stagingRest).APP_ENV).toBe('staging');
    // When set (tests, CLI), it must still be a URL.
    expect(() => EnvSchema.parse({ ...valid, DATABASE_URL_SYSTEM: 'not a url' })).toThrow(
      /DATABASE_URL_SYSTEM/,
    );
  });

  it('defaults TRUST_PROXY_HOPS to 1 and coerces it', () => {
    expect(EnvSchema.parse(valid).TRUST_PROXY_HOPS).toBe(1);
    expect(EnvSchema.parse({ ...valid, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    expect(EnvSchema.parse({ ...valid, TRUST_PROXY_HOPS: '0' }).TRUST_PROXY_HOPS).toBe(0);
  });

  it('rejects a negative or fractional TRUST_PROXY_HOPS', () => {
    expect(() => EnvSchema.parse({ ...valid, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => EnvSchema.parse({ ...valid, TRUST_PROXY_HOPS: '1.5' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
    expect(() => EnvSchema.parse({ ...valid, TRUST_PROXY_HOPS: 'all' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
  });

  it('throws on a missing or invalid variable', () => {
    const { DATABASE_URL: _omit, ...missing } = valid;
    expect(() => EnvSchema.parse(missing)).toThrow(/DATABASE_URL/);
    expect(() => EnvSchema.parse({ ...valid, WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN/);
    expect(() => EnvSchema.parse({ ...valid, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects REDIS_URL that is not redis:/rediss:', () => {
    for (const bad of ['http://localhost:6379', 'postgresql://x']) {
      expect(() => EnvSchema.parse({ ...valid, REDIS_URL: bad })).toThrow(/redis:/);
    }
    // Not a URL at all: a validation error, not a TypeError from `new URL`.
    expect(() => EnvSchema.parse({ ...valid, REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
    expect(EnvSchema.parse({ ...valid, REDIS_URL: 'rediss://h:6380/2' }).REDIS_URL).toBe(
      'rediss://h:6380/2',
    );
  });

  it('requires a JWT_SECRET of at least 32 characters', () => {
    const { JWT_SECRET: _omit, ...missing } = valid;
    expect(() => EnvSchema.parse(missing)).toThrow(/JWT_SECRET/);
    expect(() => EnvSchema.parse({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
    expect(EnvSchema.parse({ ...valid, JWT_SECRET: 'x'.repeat(32) }).JWT_SECRET).toHaveLength(32);
  });

  it('accepts a TOTP_ENCRYPTION_KEY that is canonical base64 of exactly 32 bytes', () => {
    expect(EnvSchema.parse(valid).TOTP_ENCRYPTION_KEY).toBe(valid.TOTP_ENCRYPTION_KEY);
  });

  it('accepts the .env.example and CI TOTP keys in development only', () => {
    for (const key of [
      'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
      'Y2ktb25seS10b3RwLWtleS0zMi1ieXRlcy1sb25nISE=',
    ]) {
      expect(EnvSchema.parse({ ...valid, TOTP_ENCRYPTION_KEY: key }).TOTP_ENCRYPTION_KEY).toBe(key);
      expect(
        EnvSchema.parse({ ...valid, APP_ENV: 'development', TOTP_ENCRYPTION_KEY: key })
          .TOTP_ENCRYPTION_KEY,
      ).toBe(key);
      expect(() =>
        EnvSchema.parse({ ...valid, APP_ENV: 'staging', TOTP_ENCRYPTION_KEY: key }),
      ).toThrow(/TOTP_ENCRYPTION_KEY/);
    }
  });

  it('rejects a TOTP_ENCRYPTION_KEY that is not 32 bytes or not canonical base64', () => {
    const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');
    const key = valid.TOTP_ENCRYPTION_KEY;
    for (const bad of [
      b64(31),
      b64(33),
      b64(16),
      '',
      // Not base64 at all: Buffer.from silently drops the invalid characters.
      `${key.slice(0, -4)}!!!=`,
      // Missing padding, embedded whitespace, base64url alphabet: decode but do not round-trip.
      key.replace(/=$/, ''),
      `${key.slice(0, 10)} ${key.slice(10)}`,
      Buffer.alloc(32, 0xfb).toString('base64url'),
    ]) {
      expect(() => EnvSchema.parse({ ...valid, TOTP_ENCRYPTION_KEY: bad }), bad).toThrow(
        /TOTP_ENCRYPTION_KEY/,
      );
    }
  });

  it('requires SMTP_URL and EMAIL_FROM', () => {
    expect(() => EnvSchema.parse({ ...valid, SMTP_URL: 'not a url' })).toThrow(/SMTP_URL/);
    expect(() => EnvSchema.parse({ ...valid, EMAIL_FROM: 'ab' })).toThrow(/EMAIL_FROM/);
    const { EMAIL_FROM: _omit, ...missing } = valid;
    expect(() => EnvSchema.parse(missing)).toThrow(/EMAIL_FROM/);
  });

  it('defaults SMS_PROVIDER to console and rejects unknown providers', () => {
    expect(EnvSchema.parse(valid).SMS_PROVIDER).toBe('console');
    expect(() => EnvSchema.parse({ ...valid, SMS_PROVIDER: 'twilio' })).toThrow(/SMS_PROVIDER/);
  });

  it('refuses the console SMS provider only when APP_ENV=production', () => {
    expect(() => EnvSchema.parse({ ...valid, APP_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
    expect(() =>
      EnvSchema.parse({ ...valid, APP_ENV: 'production', NODE_ENV: 'development' }),
    ).toThrow(/SMS_PROVIDER/);
    // Staging images run NODE_ENV=production: the tier, not NODE_ENV, decides.
    expect(
      EnvSchema.parse({ ...staging, APP_ENV: 'staging', NODE_ENV: 'production' }).SMS_PROVIDER,
    ).toBe('console');
    expect(EnvSchema.parse({ ...valid, NODE_ENV: 'production' }).SMS_PROVIDER).toBe('console');
  });

  it('defaults APP_ENV to development and rejects unknown tiers', () => {
    expect(EnvSchema.parse(valid).APP_ENV).toBe('development');
    expect(EnvSchema.parse({ ...staging, APP_ENV: 'staging' }).APP_ENV).toBe('staging');
    for (const bad of ['prod', 'test', '']) {
      expect(() => EnvSchema.parse({ ...valid, APP_ENV: bad })).toThrow(/APP_ENV/);
    }
  });

  it('parses HIBP_ENABLED as a string boolean, on by default', () => {
    expect(EnvSchema.parse(valid).HIBP_ENABLED).toBe(true);
    expect(EnvSchema.parse({ ...valid, HIBP_ENABLED: 'false' }).HIBP_ENABLED).toBe(false);
    expect(EnvSchema.parse({ ...valid, HIBP_ENABLED: 'true' }).HIBP_ENABLED).toBe(true);
    expect(() => EnvSchema.parse({ ...valid, HIBP_ENABLED: 'maybe' })).toThrow(/HIBP_ENABLED/);
  });

  it('defaults COOKIE_SECURE to true only in production', () => {
    expect(EnvSchema.parse(valid).COOKIE_SECURE).toBe(false);
    expect(EnvSchema.parse({ ...valid, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
    expect(EnvSchema.parse({ ...valid, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(
      EnvSchema.parse({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE,
    ).toBe(false);
    expect(
      EnvSchema.parse({ ...valid, NODE_ENV: 'test', COOKIE_SECURE: 'true' }).COOKIE_SECURE,
    ).toBe(true);
    expect(EnvSchema.parse({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  describe('deployable environments (APP_ENV staging|production)', () => {
    /** First path segment of every issue (production also refuses SMS_PROVIDER=console). */
    const issuePaths = (input: Record<string, unknown>) => {
      const parsed = EnvSchema.safeParse(input);
      return parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0]));
    };

    it('accepts a well-formed staging env', () => {
      expect(EnvSchema.parse(staging).APP_ENV).toBe('staging');
      // Production: only the (still undecided) SMS provider is refused.
      expect(issuePaths({ ...staging, APP_ENV: 'production' })).toEqual(['SMS_PROVIDER']);
    });

    it.each([
      ['JWT_SECRET', 'dev-only-jwt-secret-change-me-0123456789abcdef'],
      ['JWT_SECRET', 'ci-only-jwt-secret-not-a-real-secret-0123456789'],
      ['JWT_SECRET', 'test-only-jwt-secret-0123456789abcdef'],
      ['JWT_SECRET', 'x'.repeat(48)],
      ['TOTP_ENCRYPTION_KEY', 'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE='],
      ['TOTP_ENCRYPTION_KEY', 'Y2ktb25seS10b3RwLWtleS0zMi1ieXRlcy1sb25nISE='],
      ['TOTP_ENCRYPTION_KEY', Buffer.from('test-only-totp-key-32-bytes-long').toString('base64')],
      ['DATABASE_URL', 'postgresql://app_user:app@postgres:5432/nibras'],
      ['DATABASE_URL_SYSTEM', 'postgresql://app_system:app@postgres:5432/nibras'],
      ['COOKIE_SECURE', 'false'],
      ['WEB_ORIGIN', 'http://staging.example.com'],
      ['S3_SECRET_KEY', 'minioadmin'],
      ['S3_SECRET_KEY', 'change-me'],
    ])('rejects %s=%s on staging and production, accepts it in development', (key, value) => {
      expect(() => EnvSchema.parse({ ...staging, [key]: value })).toThrow(new RegExp(key));
      expect(issuePaths({ ...staging, [key]: value })).toEqual([key]);
      expect(issuePaths({ ...staging, APP_ENV: 'production', [key]: value })).toEqual([
        'SMS_PROVIDER',
        key,
      ]);
      expect(() => EnvSchema.parse({ ...valid, [key]: value })).not.toThrow();
      expect(() =>
        EnvSchema.parse({ ...staging, APP_ENV: 'development', [key]: value }),
      ).not.toThrow();
    });

    it('reports every offending variable at once (the startup error lists them all)', () => {
      expect(
        issuePaths({
          ...valid,
          APP_ENV: 'staging',
          JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
          TOTP_ENCRYPTION_KEY: 'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
        }),
      ).toEqual([
        'JWT_SECRET',
        'TOTP_ENCRYPTION_KEY',
        'DATABASE_URL',
        'DATABASE_URL_SYSTEM',
        'S3_SECRET_KEY',
        'COOKIE_SECURE',
        'WEB_ORIGIN',
      ]);
    });

    it('HIBP_ENABLED stays a free choice in production and staging (owner Q2)', () => {
      // Production refuses SMS_PROVIDER=console (the only provider today), never HIBP_ENABLED.
      expect(issuePaths({ ...staging, APP_ENV: 'production', HIBP_ENABLED: 'false' })).toEqual([
        'SMS_PROVIDER',
      ]);
      expect(EnvSchema.parse({ ...staging, HIBP_ENABLED: 'false' }).HIBP_ENABLED).toBe(false);
    });

    it('a staging env without COOKIE_SECURE defaults to true under NODE_ENV=production and passes', () => {
      const { COOKIE_SECURE: _omit, ...rest } = staging;
      expect(EnvSchema.parse(rest).COOKIE_SECURE).toBe(true);
      // ...but not under another NODE_ENV: the default is false and staging refuses it.
      expect(issuePaths({ ...rest, NODE_ENV: 'test' })).toEqual(['COOKIE_SECURE']);
    });
  });
  describe('SP3 object storage and video provider', () => {
    it('S3_* are required; VIDEO_PROVIDER defaults to s3; cloudflare_stream needs every CLOUDFLARE_* variable', () => {
      const env = EnvSchema.parse(valid);
      expect(env.VIDEO_PROVIDER).toBe('s3');
      expect(env).toMatchObject({
        S3_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: true,
        S3_BUCKET: 'nibras-dev',
      });
      expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
      for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
        expect(() => EnvSchema.parse({ ...valid, [key]: undefined }), key).toThrow(new RegExp(key));
        expect(() => EnvSchema.parse({ ...valid, [key]: '' }), key).toThrow(new RegExp(key));
      }
      expect(() => EnvSchema.parse({ ...valid, VIDEO_PROVIDER: 'cloudflare_stream' })).toThrow(
        /CLOUDFLARE_ACCOUNT_ID/,
      );
      expect(EnvSchema.parse({ ...valid, ...cloudflare }).VIDEO_PROVIDER).toBe('cloudflare_stream');
    });

    it('reports one issue per missing CLOUDFLARE_* variable (empty = missing)', () => {
      const parsed = EnvSchema.safeParse({ ...valid, VIDEO_PROVIDER: 'cloudflare_stream' });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((i) => String(i.path[0])).sort()).toEqual(
        [...CLOUDFLARE_KEYS].sort(),
      );
      for (const key of CLOUDFLARE_KEYS) {
        const partial = EnvSchema.safeParse({ ...valid, ...cloudflare, [key]: '' });
        expect(
          partial.error?.issues.map((i) => String(i.path[0])),
          key,
        ).toEqual([key]);
      }
    });

    it('treats empty optional values as unset (compose passes ${VAR:-})', () => {
      const env = EnvSchema.parse({
        ...valid,
        S3_PUBLIC_ENDPOINT: '',
        ...Object.fromEntries(CLOUDFLARE_KEYS.map((k) => [k, ''])),
      });
      expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
      for (const key of CLOUDFLARE_KEYS) expect(env[key as keyof typeof env], key).toBeUndefined();
    });

    it('validates the S3 settings', () => {
      expect(() => EnvSchema.parse({ ...valid, S3_ENDPOINT: 'minio:9000' })).toThrow(/S3_ENDPOINT/);
      expect(() => EnvSchema.parse({ ...valid, S3_PUBLIC_ENDPOINT: 'nope' })).toThrow(
        /S3_PUBLIC_ENDPOINT/,
      );
      for (const bad of ['ab', 'Nibras-Dev', 'nibras_dev', 'x'.repeat(64)]) {
        expect(() => EnvSchema.parse({ ...valid, S3_BUCKET: bad }), bad).toThrow(/S3_BUCKET/);
      }
      expect(EnvSchema.parse({ ...valid, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(
        false,
      );
      expect(() => EnvSchema.parse({ ...valid, S3_FORCE_PATH_STYLE: 'maybe' })).toThrow(
        /S3_FORCE_PATH_STYLE/,
      );
      expect(EnvSchema.parse({ ...valid, S3_REGION: 'gra' }).S3_REGION).toBe('gra');
      expect(() => EnvSchema.parse({ ...valid, VIDEO_PROVIDER: 'mux' })).toThrow(/VIDEO_PROVIDER/);
    });

    it('staging refuses S3_SECRET_KEY=minioadmin and placeholder Cloudflare secrets', () => {
      const issuePaths = (input: Record<string, unknown>) => {
        const parsed = EnvSchema.safeParse(input);
        return parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0]));
      };
      expect(issuePaths({ ...staging, ...cloudflare })).toEqual([]);
      expect(issuePaths({ ...staging, S3_SECRET_KEY: 'minioadmin' })).toEqual(['S3_SECRET_KEY']);
      for (const key of [
        'CLOUDFLARE_STREAM_API_TOKEN',
        'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
        'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
      ]) {
        expect(issuePaths({ ...staging, ...cloudflare, [key]: 'change-me' }), key).toEqual([key]);
        // Development accepts it.
        expect(issuePaths({ ...valid, ...cloudflare, [key]: 'change-me' }), key).toEqual([]);
      }
    });
  });
});
