import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const CONTROL_CLASSES =
  'w-full rounded-md border border-gray-300 px-3 py-2 bg-white focus-visible:outline-2 focus-visible:outline-brand-600';

/** Label + control + optional error. The error is a live region (`role="alert"`). */
export function Field({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[CONTROL_CLASSES, className].filter(Boolean).join(' ')} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={[CONTROL_CLASSES, className].filter(Boolean).join(' ')} {...props} />;
}

/** Checkbox with a wrapping label (no separate `Field` needed). */
export function Checkbox({
  label,
  className,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className={['size-4', className].filter(Boolean).join(' ')}
        {...props}
      />
      {label}
    </label>
  );
}

/** Inline message block; `role="alert"` so screen readers announce it. */
export function Alert({
  children,
  variant = 'error',
  className,
}: {
  children: ReactNode;
  variant?: 'error' | 'info';
  className?: string;
}) {
  const variantClasses =
    variant === 'error' ? 'border-danger text-danger' : 'border-brand-300 text-brand-800';
  return (
    <p
      role="alert"
      className={['rounded-md border px-3 py-2 text-sm', variantClasses, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </p>
  );
}
