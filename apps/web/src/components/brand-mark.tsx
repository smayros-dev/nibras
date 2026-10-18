import { cn } from '@nibras/ui';
import { Flame } from 'lucide-react';

/**
 * The product mark (a lamp flame: نبراس is a lamp) and its name. `name` comes from
 * `common.appName`, so the brand is never hard-coded. Decorative glyph; the name is the text.
 */
export function BrandMark({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-bold tracking-tight text-fg',
        size === 'lg' ? 'text-xl' : 'text-lg',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-fg shadow-sm',
          size === 'lg' ? 'size-10' : 'size-8',
        )}
      >
        <Flame className={size === 'lg' ? 'size-6' : 'size-5'} strokeWidth={2.25} />
      </span>
      <span>{name}</span>
    </span>
  );
}
