import type { ReactNode } from 'react';

/**
 * Centred full-page message (404, error boundary): a `main` landmark with the `h1`, a description
 * and actions. Rendered outside the app shell, so it brings its own landmark.
 */
export function StatusPage({
  code,
  title,
  description,
  details,
  actions,
}: {
  code?: string;
  title: ReactNode;
  description: ReactNode;
  details?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12 text-fg focus:outline-none"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        {code ? (
          <p aria-hidden="true" className="text-5xl font-bold text-primary tabular-nums">
            {code}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-fg-muted">{description}</p>
        {details}
        <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
      </div>
    </main>
  );
}
