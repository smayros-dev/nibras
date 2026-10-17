import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `none` for edge-to-edge content such as a `Table`. */
  padding?: 'none' | 'md';
}

const CardRoot = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-4 rounded-md border border-border bg-surface text-fg',
        padding === 'md' ? 'p-4 sm:p-6' : 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
});

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props} />;
});

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: 'h2' | 'h3';
}

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { as: Heading = 'h2', className, ...props },
  ref,
) {
  return (
    <Heading ref={ref} className={cn('text-lg font-semibold text-fg', className)} {...props} />
  );
});

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-fg-muted', className)} {...props} />;
  },
);

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-4', className)} {...props} />;
});

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-wrap items-center justify-end gap-2', className)}
      {...props}
    />
  );
});

/** Surface + border + `md` radius (no shadow: shadows are for floating surfaces only). */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
  Footer: CardFooter,
});
