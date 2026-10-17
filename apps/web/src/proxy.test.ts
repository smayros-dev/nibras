import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import proxy, { config } from './proxy';

/** Request headers Next forwards to the render (`NextResponse.next({ request: { headers } })`). */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe('proxy security headers', () => {
  it('puts a fresh nonce in the response CSP and forwards it to the render', () => {
    const a = proxy(new NextRequest('http://localhost/fr/login'));
    const b = proxy(new NextRequest('http://localhost/fr/login'));
    const csp = a.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(forwarded(a, 'x-nonce')).toBe(nonce);
    expect(forwarded(a, 'content-security-policy')).toBe(csp);
    expect(b.headers.get('content-security-policy')).not.toBe(csp);
    expect(a.headers.get('referrer-policy')).toBe('no-referrer');
    expect(a.headers.get('x-content-type-options')).toBe('nosniff');
    expect(a.headers.get('permissions-policy')).toContain('camera=(self)');
  });

  it('ignores a client-supplied x-nonce', () => {
    const res = proxy(
      new NextRequest('http://localhost/fr/login', { headers: { 'x-nonce': 'evil' } }),
    );
    expect(forwarded(res, 'x-nonce')).not.toBe('evil');
  });

  it('overwrites a client-supplied content-security-policy request header', () => {
    const evil = "script-src * 'nonce-evil'";
    const res = proxy(
      new NextRequest('http://localhost/fr/login', {
        headers: { 'content-security-policy': evil },
      }),
    );
    const csp = res.headers.get('content-security-policy');
    expect(csp).toMatch(/'nonce-[^']+'/);
    expect(forwarded(res, 'content-security-policy')).toBe(csp);
    expect(forwarded(res, 'content-security-policy')).not.toContain('nonce-evil');
  });

  it('keeps the security headers on the locale redirect', () => {
    const res = proxy(new NextRequest('http://localhost/'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('proxy matcher', () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it('runs on pages, including unknown paths with a dot (their 404 still gets the CSP)', () => {
    for (const url of [
      '/',
      '/fr',
      '/fr/login',
      '/ar/app/settings/profile',
      '/fr/x.y',
      '/fr/a.b/c',
    ]) {
      expect(runs(url), url).toBe(true);
    }
  });

  it('skips the API, health routes, Next internals and known static files', () => {
    for (const url of [
      '/api/v1/me',
      '/health',
      '/health/live',
      '/_next/static/chunks/main.js',
      '/sw.js',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/favicon.ico',
      '/robots.txt',
    ]) {
      expect(runs(url), url).toBe(false);
    }
  });
});
