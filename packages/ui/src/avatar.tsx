import { Avatar as AvatarPrimitive } from 'radix-ui';
import { forwardRef } from 'react';
import { cn } from './cn';

/**
 * Tone classes, listed literally so Tailwind generates them (tokens `--color-avatar-0…7` in
 * `tokens.css`). A class, never an inline `style`: SSR output stays CSP-clean.
 */
const TONES = [
  'bg-avatar-0',
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
] as const;

const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-base' } as const;

/** First letter of the first two words, upper-cased for the user's script (`toLocaleUpperCase`). */
export function avatarInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** Deterministic tone class: djb2 hash of `key` modulo 8. */
export function avatarTone(key: string): (typeof TONES)[number] {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  return TONES[Math.abs(hash) % TONES.length]!;
}

export interface AvatarProps {
  name: string;
  /** Stable key for the tone (user id); falls back to `name`. */
  id?: string;
  src?: string;
  size?: keyof typeof SIZES;
  className?: string;
}

/** User picture with an initials fallback; exposed as one image named `name`. */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, id, src, size = 'md', className },
  ref,
) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-fg select-none',
        avatarTone(id ?? name),
        SIZES[size],
        className,
      )}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback aria-hidden="true">{avatarInitials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
