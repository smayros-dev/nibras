import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // Self-contained server for the container image (infra/docker/web.Dockerfile).
  output: 'standalone',
  transpilePackages: ['@tt/ui', '@tt/i18n', '@tt/contracts'],
  // The browser talks to the API same-origin (session cookies work without CORS).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
