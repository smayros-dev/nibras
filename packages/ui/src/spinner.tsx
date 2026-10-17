import { LoaderCircle } from 'lucide-react';
import { cn } from './cn';
import { VisuallyHidden } from './visually-hidden';

const SIZE_CLASSES = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZE_CLASSES;
  /** Translated by the caller; the French default is only a fallback. */
  label?: string;
  className?: string;
}

/** Busy indicator announced as a polite status (`role="status"`). */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex items-center text-current', className)}>
      <LoaderCircle aria-hidden="true" className={cn('animate-spin', SIZE_CLASSES[size])} />
      <VisuallyHidden>{label ?? 'Chargement'}</VisuallyHidden>
    </span>
  );
}
