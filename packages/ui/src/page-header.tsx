import { ChevronRight } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface PageHeaderBreadcrumbs {
  /** Accessible name of the breadcrumb `<nav>`, translated by the caller. */
  label: string;
  /** Ancestors as links (the caller's locale-aware `<Link>`), then the current page as text. */
  items: ReactNode[];
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Page-level actions; they wrap under the title on narrow screens. */
  actions?: ReactNode;
  breadcrumbs?: PageHeaderBreadcrumbs;
  as?: 'h1' | 'h2';
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { title, description, actions, breadcrumbs, as: Heading = 'h1', className, ...props },
  ref,
) {
  return (
    <header ref={ref} className={cn('flex flex-col gap-2', className)} {...props}>
      {breadcrumbs && breadcrumbs.items.length > 0 ? (
        <nav aria-label={breadcrumbs.label}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
            {breadcrumbs.items.map((item, index) => {
              const last = index === breadcrumbs.items.length - 1;
              return (
                <li key={index} className="inline-flex items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 rtl:-scale-x-100" />
                  ) : null}
                  {last ? (
                    <span aria-current="page" className="text-fg">
                      {item}
                    </span>
                  ) : (
                    item
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading className="text-2xl font-semibold text-fg">{title}</Heading>
          {description ? <p className="text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
});
