import { describe, expect, it } from 'vitest';
import { cookieSecureDefault, EnvSchema } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app_user:app@localhost:5432/tt',
  DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/tt',
  REDIS_URL: 'redis://localhost:6379/0',
  WEB_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'info',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'TT <no-reply@tt.localhost>',
  JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef',
  // 'test-only-totp-key-32-bytes-long' (32 bytes)
  TOTP_ENCRYPTION_KEY: Buffer.from('test-only-totp-key-32-bytes-long').toString('base64'),
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
    // The .env.example and CI keys.
    for (const key of [
      'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
      'Y2ktb25seS10b3RwLWtleS0zMi1ieXRlcy1sb25nISE=',
    ]) {
      expect(EnvSchema.parse({ ...valid, TOTP_ENCRYPTION_KEY: key }).TOTP_ENCRYPTION_KEY).toBe(key);
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

  it('refuses the console SMS provider in production', () => {
    expect(() => EnvSchema.parse({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
    expect(() =>
      EnvSchema.parse({ ...valid, NODE_ENV: 'production', SMS_PROVIDER: 'console' }),
    ).toThrow(/SMS_PROVIDER/);
    expect(EnvSchema.parse({ ...valid, NODE_ENV: 'development' }).SMS_PROVIDER).toBe('console');
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
    // A production env cannot parse yet (console SMS is refused), so check the derivation itself.
    expect(cookieSecureDefault('production')).toBe(true);
    expect(cookieSecureDefault('test')).toBe(false);
    expect(
      EnvSchema.parse({ ...valid, NODE_ENV: 'test', COOKIE_SECURE: 'true' }).COOKIE_SECURE,
    ).toBe(true);
    expect(EnvSchema.parse({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });
});
