import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { CONTROL_CLASSES } from './input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native `<select>` (best mobile UX); the chevron sits at inline-end, so it mirrors in RTL. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_CLASSES, 'appearance-none pe-9', className)}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
      />
    </div>
  );
});
