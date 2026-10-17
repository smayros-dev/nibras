import { cva } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-bg-subtle text-fg-muted',
        brand: 'border-primary bg-primary-subtle text-primary',
        success: 'border-success bg-success-subtle text-success',
        warning: 'border-warning bg-warning-subtle text-warning',
        danger: 'border-danger bg-danger-subtle text-danger',
        info: 'border-info bg-info-subtle text-info',
      },
    },
  },
);

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
}

/** Small status label (roles, workspace and report statuses). */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant, className, ...props },
  ref,
) {
  return <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
});
