'use client';

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { cn } from './cn';
import { DialogFooter, type DialogSize } from './dialog';
import {
  dialogDescriptionClasses,
  dialogOverlayClasses,
  dialogPanelClasses,
  dialogTitleClasses,
} from './dialog-classes';

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
};

export interface AlertDialogContentProps extends Omit<
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>,
  'title'
> {
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
}

const AlertDialogContent = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(function AlertDialogContent(
  { title, description, size = 'sm', className, children, ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={dialogOverlayClasses}>
        <AlertDialogPrimitive.Content
          ref={ref}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(dialogPanelClasses, SIZE_CLASSES[size], className)}
          {...props}
        >
          <div className="flex flex-col gap-1">
            <AlertDialogPrimitive.Title className={dialogTitleClasses}>
              {title}
            </AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description className={dialogDescriptionClasses}>
                {description}
              </AlertDialogPrimitive.Description>
            ) : null}
          </div>
          {children}
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Overlay>
    </AlertDialogPrimitive.Portal>
  );
});

type ActionButtonProps = Omit<ButtonProps, 'variant' | 'asChild'>;

/** Dismisses without acting; receives initial focus (Radix). */
const AlertDialogCancel = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function AlertDialogCancel(props, ref) {
    return (
      <AlertDialogPrimitive.Cancel asChild>
        <Button ref={ref} variant="secondary" {...props} />
      </AlertDialogPrimitive.Cancel>
    );
  },
);

export interface AlertDialogActionProps extends ActionButtonProps {
  /** Irreversible action (remove, revoke…): rendered with the `danger` button. */
  destructive?: boolean;
}

/** Confirms and closes. For async work, keep the dialog controlled and close after success. */
const AlertDialogAction = forwardRef<HTMLButtonElement, AlertDialogActionProps>(
  function AlertDialogAction({ destructive = false, ...props }, ref) {
    return (
      <AlertDialogPrimitive.Action asChild>
        <Button ref={ref} variant={destructive ? 'danger' : 'primary'} {...props} />
      </AlertDialogPrimitive.Action>
    );
  },
);

/**
 * Confirmation dialog (`role="alertdialog"`) replacing every `window.confirm`; callers render it
 * explicitly (no `useConfirm`). Not dismissed by an outside click; `Escape` cancels.
 */
export const AlertDialog = {
  Root: AlertDialogPrimitive.Root,
  Trigger: AlertDialogPrimitive.Trigger,
  Content: AlertDialogContent,
  Footer: DialogFooter,
  Cancel: AlertDialogCancel,
  Action: AlertDialogAction,
};
