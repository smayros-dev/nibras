import { Card, cn } from '@tt/ui';
import type { ReactNode } from 'react';

/**
 * The auth screens' card (spec §5): max 420 px, the page `h1`, an optional lead, the body, and an
 * optional footer (secondary links) separated by a rule.
 */
export function AuthCard({
  title,
  description,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('w-full max-w-[420px] gap-6 shadow-sm', className)}>
      <Card.Header className="gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {description ? (
          <Card.Description className="text-base">{description}</Card.Description>
        ) : null}
      </Card.Header>
      {children ? <Card.Content>{children}</Card.Content> : null}
      {footer ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm text-fg-muted">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** Centred placeholder while a client auth page reads its state (challenge, token, setup). */
export function AuthLoading({ label }: { label: string }) {
  return (
    <p role="status" className="text-lg text-fg-muted">
      {label}
    </p>
  );
}
