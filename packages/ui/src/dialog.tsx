'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Button } from './button';
import { cn } from './cn';
import {
  dialogDescriptionClasses,
  dialogOverlayClasses,
  dialogPanelClasses,
  dialogTitleClasses,
} from './dialog-classes';

export type DialogSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

export interface DialogContentProps extends Omit<
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'title'
> {
  /** Always rendered (the accessible name); visually hidden with `hideTitle`. */
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  /** Accessible name of the close icon button, translated by the caller. */
  closeLabel: string;
  hideClose?: boolean;
  hideTitle?: boolean;
}

const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent(
    {
      title,
      description,
      size = 'md',
      closeLabel,
      hideClose = false,
      hideTitle = false,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClasses}>
          <DialogPrimitive.Content
            ref={ref}
            // Without a description, opt out explicitly (Radix warns otherwise).
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(dialogPanelClasses, SIZE_CLASSES[size], className)}
            {...props}
          >
            <div className={cn('flex flex-col gap-1', !hideClose && 'pe-10')}>
              <DialogPrimitive.Title className={hideTitle ? 'sr-only' : dialogTitleClasses}>
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className={dialogDescriptionClasses}>
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {children}
            {/* Last in DOM order so initial focus goes to the content, first visually. */}
            {hideClose ? null : (
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
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    );
  },
);

/** Actions row: stacked (primary on top) on mobile, aligned to inline-end from `sm`. */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

/**
 * Modal dialog on Radix (focus trap and restore, `Escape`, scroll lock, `aria-hidden` siblings).
 * `<Dialog.Root><Dialog.Trigger/><Dialog.Content title closeLabel>…<Dialog.Footer/></Dialog.Content></Dialog.Root>`
 */
export const Dialog = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Content: DialogContent,
  Footer: DialogFooter,
  Close: DialogPrimitive.Close,
};
