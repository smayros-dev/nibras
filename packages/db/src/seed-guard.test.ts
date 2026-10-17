import { describe, expect, it } from 'vitest';
import { seedRefusal } from './seed-guard';

const url = (host: string) => `postgresql://tt:tt@${host}:5432/tt`;

describe('seedRefusal', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'LOCALHOST'])(
    'allows the loopback host %s',
    (host) => {
      expect(seedRefusal({ DATABASE_URL_SYSTEM: url(host) })).toBeNull();
    },
  );

  it('allows APP_ENV=development and an empty APP_ENV', () => {
    expect(
      seedRefusal({ APP_ENV: 'development', DATABASE_URL_SYSTEM: url('localhost') }),
    ).toBeNull();
    expect(seedRefusal({ APP_ENV: '', DATABASE_URL_SYSTEM: url('localhost') })).toBeNull();
  });

  it('refuses the compose/staging host `postgres` without an opt-in', () => {
    expect(seedRefusal({ APP_ENV: 'development', DATABASE_URL_SYSTEM: url('postgres') })).toMatch(
      /host "postgres" is not local.*SEED_ALLOW_HOST=postgres/,
    );
  });

  it('allows a non-local host only when SEED_ALLOW_HOST names that exact host', () => {
    expect(
      seedRefusal({ DATABASE_URL_SYSTEM: url('postgres'), SEED_ALLOW_HOST: 'postgres' }),
    ).toBeNull();
    expect(
      seedRefusal({ DATABASE_URL_SYSTEM: url('postgres'), SEED_ALLOW_HOST: 'postgres2' }),
    ).toMatch(/SEED_ALLOW_HOST="postgres2" does not match host "postgres"/);
    expect(
      seedRefusal({ DATABASE_URL_SYSTEM: url('db.staging.internal'), SEED_ALLOW_HOST: '*' }),
    ).toMatch(/does not match/);
    expect(seedRefusal({ DATABASE_URL_SYSTEM: url('postgres'), SEED_ALLOW_HOST: '' })).toMatch(
      /is not local/,
    );
  });

  it('keeps refusing non-development environments even with the opt-in', () => {
    const base = { DATABASE_URL_SYSTEM: url('postgres'), SEED_ALLOW_HOST: 'postgres' };
    expect(seedRefusal({ ...base, APP_ENV: 'staging' })).toMatch(/APP_ENV=staging/);
    expect(seedRefusal({ ...base, NODE_ENV: 'production' })).toBe('NODE_ENV=production');
    expect(seedRefusal({ DATABASE_URL_SYSTEM: url('localhost'), APP_ENV: 'production' })).toMatch(
      /APP_ENV=production/,
    );
  });

  it('refuses a missing or invalid DATABASE_URL_SYSTEM', () => {
    expect(seedRefusal({})).toBe('DATABASE_URL_SYSTEM is not set');
    expect(seedRefusal({ DATABASE_URL_SYSTEM: 'not a url' })).toBe(
      'DATABASE_URL_SYSTEM is not a valid URL',
    );
  });
});
