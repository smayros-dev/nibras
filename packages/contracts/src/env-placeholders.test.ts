import { describe, expect, it } from 'vitest';

import {
  assertDeployableEnv,
  dbPasswordOf,
  hasWeakEntropy,
  INIT_SQL_DB_PASSWORD,
  isPlaceholderSecret,
  PLACEHOLDER_SECRETS,
} from './env-placeholders';

describe('isPlaceholderSecret', () => {
  it('flags the .env.example, CI and test-fixture values', () => {
    for (const value of [
      'dev-only-jwt-secret-change-me-0123456789abcdef',
      'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
      'ci-only-jwt-secret-not-a-real-secret-0123456789',
      'Y2ktb25seS10b3RwLWtleS0zMi1ieXRlcy1sb25nISE=',
      'test-only-jwt-secret-0123456789abcdef',
      Buffer.from('test-only-totp-key-32-bytes-long').toString('base64'),
      // MinIO root credentials (docker-compose.yml, .env.example, CI)
      'minioadmin',
    ]) {
      expect(PLACEHOLDER_SECRETS.has(value), value).toBe(true);
      expect(isPlaceholderSecret(value), value).toBe(true);
    }
  });

  it('flags any dev-/ci-/test-only value and anything containing change-me', () => {
    expect(isPlaceholderSecret('DEV-ONLY-something-else')).toBe(true);
    expect(isPlaceholderSecret('test-only')).toBe(true);
    expect(isPlaceholderSecret('my-Secret-CHANGE-ME-please')).toBe(true);
    expect(isPlaceholderSecret('  ci-only-padded  ')).toBe(true);
  });

  it('accepts random values', () => {
    expect(isPlaceholderSecret('Qm9vaywgY2F0cywgdGVhIGFuZCAzMiByYW5kb20gYnl0ZXM=')).toBe(false);
    expect(isPlaceholderSecret(Buffer.alloc(32, 0x5a).toString('base64'))).toBe(false);
    // "only" in the middle is not the prefix.
    expect(isPlaceholderSecret('x-dev-only-y')).toBe(false);
  });
});

describe('hasWeakEntropy', () => {
  it('flags fewer than 3 character classes and single repeated characters', () => {
    expect(hasWeakEntropy('x'.repeat(48))).toBe(true);
    expect(hasWeakEntropy('abcdefabcdef0123456789')).toBe(true); // hex: 2 classes
    expect(hasWeakEntropy('ABCDEFGHabcdefgh')).toBe(true);
    expect(hasWeakEntropy('!'.repeat(40))).toBe(true);
    expect(hasWeakEntropy('')).toBe(true);
  });

  it('accepts 3 or more classes', () => {
    expect(hasWeakEntropy('Qm9vaywgY2F0cywgdGVhIGFuZCAzMiByYW5kb20gYnl0ZXM=')).toBe(false);
    expect(hasWeakEntropy('abc123!@#')).toBe(false);
    expect(hasWeakEntropy('ABC123def')).toBe(false);
  });
});

describe('dbPasswordOf', () => {
  it('returns the decoded password of a connection URL', () => {
    expect(dbPasswordOf('postgresql://app_user:app@localhost:5432/nibras')).toBe(
      INIT_SQL_DB_PASSWORD,
    );
    expect(dbPasswordOf('postgresql://u:p%40ss%2Fw@h:5432/db')).toBe('p@ss/w');
    expect(dbPasswordOf('postgresql://u@h:5432/db')).toBe('');
  });

  it('returns null for something that is not a URL', () => {
    expect(dbPasswordOf('not a url')).toBeNull();
    expect(dbPasswordOf('')).toBeNull();
  });
});

describe('assertDeployableEnv', () => {
  const deployable = {
    APP_ENV: 'staging',
    JWT_SECRET: 'Qm9vaywgY2F0cywgdGVhIGFuZCAzMiByYW5kb20gYnl0ZXM=',
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 0x5a).toString('base64'),
    DATABASE_URL: 'postgresql://app_user:s3cr3t-random@postgres:5432/nibras',
    DATABASE_URL_SYSTEM: 'postgresql://app_system:other-random@postgres:5432/nibras',
    COOKIE_SECURE: true,
    WEB_ORIGIN: 'https://staging.example.com',
  };
  const placeholders = {
    APP_ENV: 'production',
    JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
    TOTP_ENCRYPTION_KEY: 'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyE=',
    DATABASE_URL: 'postgresql://app_user:app@localhost:5432/nibras',
    DATABASE_URL_SYSTEM: 'postgresql://app_system:app@localhost:5432/nibras',
    COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  };
  const collect = (e: Parameters<typeof assertDeployableEnv>[0]) => {
    const issues: Array<[string, string]> = [];
    assertDeployableEnv(e, (path, message) => issues.push([path, message]));
    return issues;
  };

  it('reports nothing for a well-formed deployable env', () => {
    expect(collect(deployable)).toEqual([]);
  });

  it('reports one issue per offending variable outside development', () => {
    const issues = collect(placeholders);
    expect(issues.map(([path]) => path)).toEqual([
      'JWT_SECRET',
      'TOTP_ENCRYPTION_KEY',
      'DATABASE_URL',
      'DATABASE_URL_SYSTEM',
      'COOKIE_SECURE',
      'WEB_ORIGIN',
    ]);
    expect(issues[0]?.[1]).toBe(
      'JWT_SECRET is a development placeholder: generate a real value (openssl rand -base64 48)',
    );
    expect(issues[4]?.[1]).toBe('COOKIE_SECURE must be true when APP_ENV=production');
  });

  it('flags a weak JWT_SECRET that is not a known placeholder', () => {
    expect(collect({ ...deployable, JWT_SECRET: 'x'.repeat(48) })).toEqual([
      ['JWT_SECRET', expect.stringMatching(/JWT_SECRET.*openssl rand -base64 48/)],
    ]);
  });

  it('is a no-op in development', () => {
    expect(collect({ ...placeholders, APP_ENV: 'development' })).toEqual([]);
  });

  it('skips the variables a service does not have (worker: no JWT, TOTP key or cookies)', () => {
    expect(
      collect({
        APP_ENV: 'staging',
        DATABASE_URL_SYSTEM: deployable.DATABASE_URL_SYSTEM,
        WEB_ORIGIN: deployable.WEB_ORIGIN,
      }),
    ).toEqual([]);
    expect(
      collect({
        APP_ENV: 'staging',
        DATABASE_URL_SYSTEM: placeholders.DATABASE_URL_SYSTEM,
        WEB_ORIGIN: placeholders.WEB_ORIGIN,
      }).map(([path]) => path),
    ).toEqual(['DATABASE_URL_SYSTEM', 'WEB_ORIGIN']);
  });

  it('refuses the MinIO and Cloudflare Stream placeholder secrets outside development (SP3)', () => {
    const media = {
      S3_SECRET_KEY: 'minioadmin',
      CLOUDFLARE_STREAM_API_TOKEN: 'dev-only-cloudflare-token',
      CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'change-me',
      CLOUDFLARE_STREAM_SIGNING_KEY_PEM: 'test-only-pem',
    };
    expect(collect({ ...deployable, ...media })).toEqual([
      ['S3_SECRET_KEY', expect.stringMatching(/^S3_SECRET_KEY is a development placeholder/)],
      ['CLOUDFLARE_STREAM_API_TOKEN', expect.stringMatching(/development placeholder/)],
      ['CLOUDFLARE_STREAM_WEBHOOK_SECRET', expect.stringMatching(/development placeholder/)],
      ['CLOUDFLARE_STREAM_SIGNING_KEY_PEM', expect.stringMatching(/development placeholder/)],
    ]);
    expect(collect({ ...deployable, ...media, APP_ENV: 'development' })).toEqual([]);
    expect(
      collect({
        ...deployable,
        S3_SECRET_KEY: 'Zm9vYmFyLXJhbmRvbS1vdmgtc2VjcmV0LWtleQ==',
        CLOUDFLARE_STREAM_API_TOKEN: 'cf-Real-Token-123',
      }),
    ).toEqual([]);
  });
});
