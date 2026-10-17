'use client';

/**
 * Last-resort boundary when the root (locale) layout itself fails: it replaces the whole document,
 * so it carries its own `<html>`, no Tailwind, no i18n (the locale is unknown here) — French copy,
 * minimal inline styles that follow the OS colour scheme.
 */
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  return (
    <html lang="fr" dir="ltr">
      <head>
        <title>Une erreur est survenue</title>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1rem',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem' }}>Une erreur est survenue</h1>
          <p>La page n’a pas pu s’afficher. Réessayez dans un instant.</p>
          {error.digest ? (
            <p style={{ opacity: 0.75 }}>Référence de l’erreur : {error.digest}</p>
          ) : null}
          <p style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => (retry ?? reset)?.()}
              style={{ minHeight: '44px', padding: '0 1rem', font: 'inherit', cursor: 'pointer' }}
            >
              Réessayer
            </button>
            {/* A plain link: the router may be the thing that failed. */}
            <a href="/" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
              Retour à l’accueil
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
