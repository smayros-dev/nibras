import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANTS: Record<AlertVariant, { icon: LucideIcon; classes: string }> = {
  info: { icon: Info, classes: 'border-info bg-info-subtle [&>svg]:text-info' },
  success: { icon: CircleCheck, classes: 'border-success bg-success-subtle [&>svg]:text-success' },
  warning: {
    icon: TriangleAlert,
    classes: 'border-warning bg-warning-subtle [&>svg]:text-warning',
  },
  danger: { icon: CircleAlert, classes: 'border-danger bg-danger-subtle [&>svg]:text-danger' },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant;
  title?: ReactNode;
  /** Optional control (e.g. a retry `Button`) placed at inline-end. */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * Inline message block. `danger` is an assertive `role="alert"`; the other variants are a polite
 * `role="status"`.
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { variant = 'info', title, action, children, className, ...props },
  ref,
) {
  const { icon: Icon, classes } = VARIANTS[variant];
  return (
    <div
      ref={ref}
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-sm text-fg',
        classes,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
});
