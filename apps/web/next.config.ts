import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { securityHeaders } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Self-contained server for the container image (infra/docker/web.Dockerfile).
  output: 'standalone',
  // Dev only: the floating dev-tools indicator sits at the physical bottom-left, over the mobile
  // bottom nav's "More" button in RTL (e2e mobile-ar). Error overlays still show.
  devIndicators: false,
  transpilePackages: ['@nibras/ui', '@nibras/i18n', '@nibras/contracts'],
  // The browser talks to the API same-origin (session cookies work without CORS).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  // --- Security headers (T15) ---
  // Static headers on every path, including those the proxy skips (`/_next/static`, `/health`,
  // public files, `/api`). The CSP itself is per request (nonce) and set by `src/proxy.ts` on
  // pages; static assets need none.
  async headers() {
    const dev = process.env.NODE_ENV === 'development';
    return [
      {
        source: '/(.*)',
        headers: Object.entries(securityHeaders({ dev })).map(([key, value]) => ({ key, value })),
      },
      // The service worker (T14) must be revalidated on every load to pick up a new version.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
  // --- end security headers ---
};

export default withNextIntl(nextConfig);
