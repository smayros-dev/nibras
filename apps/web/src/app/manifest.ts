import { BRAND } from '@nibras/ui/brand';
import type { MetadataRoute } from 'next';

/**
 * `/manifest.webmanifest` (PRD §14.6: installable PWA). One manifest for every locale: the name is
 * the brand (the same in fr/ar/en), `start_url` is `/` so the proxy negotiates the locale, and
 * `dir: 'auto'` lets the Latin name render correctly in an Arabic launcher.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: BRAND.name,
    short_name: BRAND.shortName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND.backgroundColor,
    theme_color: BRAND.themeColor,
    lang: 'fr',
    dir: 'auto',
    categories: ['education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
