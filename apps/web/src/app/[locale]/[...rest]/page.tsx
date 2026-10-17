import { notFound } from 'next/navigation';

/**
 * Unmatched paths under a locale (`/fr/does-not-exist`) render the translated
 * `[locale]/not-found.tsx` inside the locale layout instead of Next's untranslated default.
 * (The API rewrite runs before dynamic routes, so `/api/*` never reaches this.)
 */
export default function CatchAllNotFound() {
  notFound();
}
