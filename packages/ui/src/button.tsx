import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary:
    'border border-brand-600 bg-white text-brand-700 hover:bg-brand-50 focus-visible:outline-brand-600',
  danger: 'bg-danger text-white hover:opacity-90 focus-visible:outline-danger',
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
