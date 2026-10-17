import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

/**
 * Shared look of text-like controls. `text-base` (16 px) always: smaller text makes iOS Safari zoom
 * on focus. `aria-invalid` drives the danger border, so `Field` errors style the control too.
 */
export const CONTROL_CLASSES = cn(
  'block w-full min-h-11 rounded-sm border border-border-strong bg-surface px-3 py-2 text-base text-fg',
  'placeholder:text-fg-subtle',
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-danger',
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Sets `aria-invalid` (and the danger border). `Field` sets it from its `error`. */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASSES, className)}
      {...props}
    />
  );
});

/** @deprecated SP1 name, kept until every screen migrates (T9–T13); use `Input`. */
export const TextInput = Input;
