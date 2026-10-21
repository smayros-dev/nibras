import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce, parseOrigins, securityHeaders } from './security-headers';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

describe('buildCsp', () => {
  it('locks scripts to the nonce with strict-dynamic in production', () => {
    const csp = buildCsp('abc123==', { dev: false });
    const d = directives(csp);
    expect(d.get('script-src')).toBe("'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(d.get('frame-ancestors')).toBe("'none'");
    expect(d.get('object-src')).toBe("'none'");
    expect(d.get('base-uri')).toBe("'self'");
    expect(d.get('form-action')).toBe("'self'");
    expect(d.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(d.get('img-src')).toBe("'self' data: blob:");
    expect(d.get('connect-src')).toBe("'self'");
    expect(d.get('worker-src')).toBe("'self'");
    expect(d.get('manifest-src')).toBe("'self'");
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
  });

  it('adds unsafe-eval and the HMR websocket in development only', () => {
    const d = directives(buildCsp('n0nce', { dev: true }));
    expect(d.get('script-src')).toBe("'self' 'nonce-n0nce' 'strict-dynamic' 'unsafe-eval'");
    expect(d.get('connect-src')).toBe("'self' ws: wss:");
    expect(d.has('upgrade-insecure-requests')).toBe(false);
    expect(d.get('frame-ancestors')).toBe("'none'");
  });
});

describe('media origins (direct uploads to the object store)', () => {
  it('adds the configured origins to connect-src only', () => {
    const d = directives(
      buildCsp('n', { dev: false, connectOrigins: ['https://media.example.com'] }),
    );
    expect(d.get('connect-src')).toBe("'self' https://media.example.com");
    expect(d.get('default-src')).toBe("'self'");
    expect(d.get('media-src')).toBe("'self' blob:");
  });

  it('parses MEDIA_ORIGINS into bare http(s) origins and drops anything else', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(
      parseOrigins(
        'http://localhost:9000, https://media.example.com/bucket/x  javascript:alert(1) * nope',
      ),
    ).toEqual(['http://localhost:9000', 'https://media.example.com']);
  });
});

describe('securityHeaders', () => {
  it('sends HSTS in production only', () => {
    expect(securityHeaders({ dev: false })['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(securityHeaders({ dev: true })).not.toHaveProperty('Strict-Transport-Security');
  });

  it('always sends the referrer, sniffing, framing and permissions policies', () => {
    for (const dev of [true, false]) {
      const h = securityHeaders({ dev });
      expect(h['Referrer-Policy']).toBe('no-referrer');
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['X-Frame-Options']).toBe('DENY');
      expect(h['Permissions-Policy']).toBe(
        'camera=(self), microphone=(self), geolocation=(), payment=()',
      );
    }
  });
});

describe('newNonce', () => {
  it('is base64 of 16 random bytes and never repeats', () => {
    const nonces = Array.from({ length: 100 }, () => newNonce());
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(n)).toHaveLength(16);
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });
});
