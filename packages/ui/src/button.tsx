import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover focus-visible:outline-focus',
  secondary:
    'border border-primary bg-surface text-primary hover:bg-primary-subtle focus-visible:outline-focus',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover focus-visible:outline-focus',
};

// `px-*` compiles to `padding-inline` in Tailwind 4: mirrored automatically in RTL.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

/** Native `<button>` with design-system styling; `type` defaults to `button` (not `submit`). */
export function Button({
  variant,
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
    'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...props} />;
}
