import { cn } from './cn';

// No 'use client' here: server components import these as plain strings.

/**
 * Overlay that also positions its panel: bottom-anchored full width below `sm`, centred above.
 * Flex centring instead of `translate(-50%)` keeps it direction-agnostic. Shared with `AlertDialog`.
 */
export const dialogOverlayClasses = cn(
  'fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-overlay sm:items-center sm:p-4',
  'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
);

export const dialogPanelClasses = cn(
  'relative flex max-h-[90dvh] w-full flex-col gap-4 overflow-auto rounded-t-lg bg-surface-raised p-6 text-fg shadow-lg',
  'focus:outline-none sm:rounded-lg dark:border dark:border-border',
  'data-[state=open]:animate-dialog-in data-[state=closed]:animate-fade-out',
);

export const dialogTitleClasses = 'text-lg font-semibold text-fg';
export const dialogDescriptionClasses = 'text-sm text-fg-muted';
