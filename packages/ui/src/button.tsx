import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap',
    'transition-colors duration-fast ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
        secondary: 'border border-border-strong bg-surface text-fg hover:bg-bg-subtle',
        ghost: 'text-fg hover:bg-bg-subtle',
        danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // `px-*` compiles to `padding-inline`: mirrored automatically in RTL.
      size: {
        sm: 'min-h-9 px-3 text-sm',
        md: 'min-h-11 px-4 text-base',
        lg: 'min-h-12 px-6 text-lg',
        icon: 'size-11',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'min-h-0 px-0' }],
    defaultVariants: { size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner at inline-start, sets `aria-busy` and disables; the label stays visible. */
  loading?: boolean;
  /** Renders the single child (e.g. a `<Link>`) with the button styles (Radix `Slot`). */
  asChild?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

/** Design-system button; `type` defaults to `button` (not `submit`). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size = 'md',
    loading = false,
    asChild = false,
    iconStart,
    iconEnd,
    type,
    disabled,
    className,
    children,
    ...props
  },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size }), className);
  const start = loading ? (
    // Decorative here: `aria-busy` already tells assistive tech the button is working.
    <span aria-hidden="true" className="inline-flex">
      <Spinner size="sm" />
    </span>
  ) : (
    iconStart
  );
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} aria-busy={loading || undefined} {...props}>
        {start}
        <Slot.Slottable>{children}</Slot.Slottable>
        {iconEnd}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {start}
      {children}
      {iconEnd}
    </button>
  );
});
