import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative icon (e.g. a lucide icon); hidden from assistive tech. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary call to action (PRD §9.5 "vide (CTA créer)"). */
  action?: ReactNode;
  as?: 'h2' | 'h3';
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, as: Heading = 'h2', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="inline-flex rounded-full bg-bg-subtle p-3 text-fg-muted [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <Heading className="text-lg font-semibold text-fg">{title}</Heading>
      {description ? <p className="max-w-prose text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
});
