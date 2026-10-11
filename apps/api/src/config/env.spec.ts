import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app_user:app@localhost:5432/tt',
  DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/tt',
  REDIS_URL: 'redis://localhost:6379/0',
  WEB_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'info',
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
});
