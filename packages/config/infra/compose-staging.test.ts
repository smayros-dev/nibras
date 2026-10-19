import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Repo contract for `infra/compose.staging.yml` (SP1.6 F3): `.env.staging` is used for compose
 * interpolation only, each service receives the variables it needs and nothing else, and the app
 * containers run read-only without capabilities. Also keeps the staging runbook's variable table
 * in step with the compose file.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const composeSource = readFileSync(`${root}infra/compose.staging.yml`, 'utf8');
const runbook = readFileSync(`${root}docs/runbooks/staging.md`, 'utf8');

interface Service {
  env_file?: unknown;
  environment?: Record<string, string> | string[];
  read_only?: boolean;
  tmpfs?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  init?: boolean;
  restart?: string;
}

const compose = parse(composeSource, { merge: true }) as { services: Record<string, Service> };
const services = compose.services;
const APP_SERVICES = ['migrate', 'api', 'worker', 'web'] as const;

function envOf(name: string): Record<string, string> {
  const environment = services[name]?.environment;
  expect(Array.isArray(environment), `${name}: environment must be a map`).toBe(false);
  return (environment ?? {}) as Record<string, string>;
}

const envKeys = (name: string) => Object.keys(envOf(name)).sort();

/** Variables interpolated anywhere in a service definition (`${VAR}`, `${VAR:-x}`, `${VAR:?x}`). */
function interpolated(value: unknown): Set<string> {
  return new Set(
    [...JSON.stringify(value).matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1] as string),
  );
}

const SECRET_LIKE = /SECRET|PASSWORD|KEY|TOKEN|DATABASE_URL|REDIS_URL|SMTP_URL/;

describe('infra/compose.staging.yml', () => {
  it('has the four app services next to postgres, redis and minio', () => {
    expect(Object.keys(services).sort()).toEqual(
      ['api', 'migrate', 'minio', 'postgres', 'redis', 'web', 'worker'].sort(),
    );
  });

  it('no service reads an env_file (.env.staging is for interpolation only)', () => {
    for (const [name, service] of Object.entries(services)) {
      expect(service.env_file, name).toBeUndefined();
    }
    expect(composeSource).not.toMatch(/^\s*env_file\s*:/m);
  });

  it('migrate receives only DATABASE_URL_SYSTEM', () => {
    expect(envKeys('migrate')).toEqual(['DATABASE_URL_SYSTEM']);
  });

  it('api receives exactly its allocation: no BYPASSRLS URL, no Postgres password, no S3 keys', () => {
    expect(envKeys('api')).toEqual(
      [
        'APP_ENV',
        'COOKIE_SECURE',
        'DATABASE_URL',
        'EMAIL_FROM',
        'HIBP_ENABLED',
        'JWT_SECRET',
        'LOG_LEVEL',
        'NODE_ENV',
        'OTEL_EXPORTER_OTLP_ENDPOINT',
        'PORT',
        'RATE_LIMIT_ANON',
        'RATE_LIMIT_USER',
        'REDIS_URL',
        'SMS_PROVIDER',
        'SMTP_URL',
        'TOTP_ENCRYPTION_KEY',
        'TRUST_PROXY_HOPS',
        'WEB_ORIGIN',
      ].sort(),
    );
    const keys = envKeys('api');
    expect(keys).not.toContain('DATABASE_URL_SYSTEM');
    expect(keys).not.toContain('POSTGRES_PASSWORD');
    expect(keys.filter((k) => k.startsWith('S3_'))).toEqual([]);
  });

  it('worker receives exactly its allocation: no JWT/TOTP secret, no RLS-bound DATABASE_URL', () => {
    expect(envKeys('worker')).toEqual(
      [
        'APP_ENV',
        'DATABASE_URL_SYSTEM',
        'EMAIL_FROM',
        'LOG_LEVEL',
        'NODE_ENV',
        'REDIS_URL',
        'SMTP_URL',
        'WEB_ORIGIN',
        'WORKER_PORT',
      ].sort(),
    );
    const keys = envKeys('worker');
    for (const forbidden of ['JWT_SECRET', 'TOTP_ENCRYPTION_KEY', 'DATABASE_URL']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('web (the only published container) holds no secret at all', () => {
    expect(envKeys('web')).toEqual(['API_URL', 'APP_ENV', 'NODE_ENV', 'PORT']);
    expect(envKeys('web').filter((k) => SECRET_LIKE.test(k))).toEqual([]);
    // Nor through a value interpolating a secret under an innocent name.
    expect([...interpolated(services.web)].filter((v) => SECRET_LIKE.test(v))).toEqual([]);
  });

  it('each variable is passed under its own name (no secret smuggled under another key)', () => {
    for (const name of APP_SERVICES) {
      for (const [key, value] of Object.entries(envOf(name))) {
        const refs = [...interpolated(value)];
        expect(
          refs.every((r) => r === key),
          `${name}.${key} = ${value}`,
        ).toBe(true);
      }
    }
  });

  it('pins the deployment tier, NODE_ENV and the listen ports per service', () => {
    for (const name of ['api', 'worker', 'web']) {
      expect(envOf(name).APP_ENV, name).toBe('staging');
      expect(envOf(name).NODE_ENV, name).toBe('production');
    }
    expect(envOf('api').PORT).toBe('3001');
    expect(envOf('web').PORT).toBe('3000');
    expect(envOf('worker').WORKER_PORT).toBe('3002');
  });

  it('every app container is read-only, without capabilities, no-new-privileges, with init', () => {
    for (const name of APP_SERVICES) {
      const s = services[name] as Service;
      expect(s.read_only, name).toBe(true);
      expect(s.cap_drop, name).toEqual(['ALL']);
      expect(s.security_opt, name).toEqual(['no-new-privileges:true']);
      expect(s.init, name).toBe(true);
      expect(s.tmpfs, name).toContain('/tmp');
    }
    // Next.js writes its fetch/image cache at runtime.
    expect(services.web?.tmpfs).toContain('/app/apps/web/.next/cache');
  });

  it('long-running app services restart; migrate is a one-shot', () => {
    for (const name of ['api', 'worker', 'web']) {
      expect(services[name]?.restart, name).toBe('unless-stopped');
    }
    expect(services.migrate?.restart).toBe('no');
  });

  it('every interpolated variable is in the runbook table with the services that receive it', () => {
    // Rows of the staging runbook's variable table: | `VAR` | svc, svc | ... |
    const documented = new Map<string, string[]>();
    for (const m of runbook.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*([a-z, ]+?)\s*\|/gm)) {
      documented.set(
        m[1] as string,
        (m[2] as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .sort(),
      );
    }
    const receivers = new Map<string, string[]>();
    for (const [name, service] of Object.entries(services)) {
      for (const v of interpolated(service)) receivers.set(v, [...(receivers.get(v) ?? []), name]);
    }
    expect(receivers.size).toBeGreaterThan(0);
    for (const [variable, names] of receivers) {
      expect(documented.get(variable), `${variable} in docs/runbooks/staging.md`).toEqual(
        names.sort(),
      );
    }
  });
});
