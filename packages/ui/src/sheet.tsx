'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

/** Logical sides only: `start` is the left edge in ltr and the right edge in rtl. */
export type SheetSide = 'start' | 'end' | 'bottom';

/**
 * Side → position and motion. Everything is logical (`start-0`, `border-e`, `rounded-e-lg`) and the
 * slide keyframes read the direction sign from `tokens.css`, so no physical mapping is needed here.
 */
const SIDE_CLASSES: Record<SheetSide, string> = {
  start: cn(
    'inset-y-0 start-0 h-full w-[85vw] max-w-sm rounded-e-lg border-e border-border',
    'data-[state=open]:animate-sheet-in-start data-[state=closed]:animate-sheet-out-start',
  ),
  end: cn(
    'inset-y-0 end-0 h-full w-[85vw] max-w-sm rounded-s-lg border-s border-border',
    'data-[state=open]:animate-sheet-in-end data-[state=closed]:animate-sheet-out-end',
  ),
  bottom: cn(
    'bottom-0 start-0 end-0 max-h-[85dvh] rounded-t-lg border-t border-border pb-[max(1.5rem,env(safe-area-inset-bottom))]',
    'data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom',
  ),
};

export interface SheetContentProps extends Omit<
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'title'
> {
  side: SheetSide;
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close icon button, translated by the caller. */
  closeLabel: string;
  hideTitle?: boolean;
}

const SheetContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  function SheetContent(
    { side, title, description, closeLabel, hideTitle = false, className, children, ...props },
    ref,
  ) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-overlay',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
          )}
        />
        <DialogPrimitive.Content
          ref={ref}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-surface-raised p-6 text-fg shadow-lg focus:outline-none',
            SIDE_CLASSES[side],
            className,
          )}
          {...props}
        >
          <div className="flex flex-col gap-1 pe-10">
            <DialogPrimitive.Title className={hideTitle ? 'sr-only' : 'text-lg font-semibold'}>
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {children}
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={closeLabel}
              className="absolute top-2 end-2"
            >
              <X aria-hidden="true" className="size-5" />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

/** Edge panel on Radix Dialog (mobile "More" drawer, filters): `side` is `start`/`end`/`bottom`. */
export const Sheet = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Content: SheetContent,
  Close: DialogPrimitive.Close,
};
