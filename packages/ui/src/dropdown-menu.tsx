'use client';

import { Check, Circle } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from './cn';

const itemBase = cn(
  'relative flex min-h-11 cursor-default items-center gap-2 rounded-sm px-3 text-sm text-fg outline-none select-none',
  'data-[highlighted]:bg-bg-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
);

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<
  typeof MenuPrimitive.Content
> {
  align?: 'start' | 'center' | 'end';
}

const DropdownMenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent({ align = 'start', sideOffset = 4, className, ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-48 overflow-y-auto',
          'rounded-md border border-border bg-surface-raised p-1 text-fg shadow-md',
          'origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
});

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  /** Irreversible action (remove, revoke, log out of all devices). */
  destructive?: boolean;
  /** Decorative icon at inline-start. */
  icon?: ReactNode;
}

const DropdownMenuItem = forwardRef<ElementRef<typeof MenuPrimitive.Item>, DropdownMenuItemProps>(
  function DropdownMenuItem({ destructive = false, icon, className, children, ...props }, ref) {
    return (
      <MenuPrimitive.Item
        ref={ref}
        className={cn(
          itemBase,
          destructive && 'text-danger data-[highlighted]:bg-danger-subtle',
          className,
        )}
        {...props}
      >
        {icon ? (
          <span aria-hidden="true" className="inline-flex">
            {icon}
          </span>
        ) : null}
        {children}
      </MenuPrimitive.Item>
    );
  },
);

const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof MenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.CheckboxItem ref={ref} className={cn(itemBase, 'ps-8', className)} {...props}>
      <span className="absolute start-2 inline-flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
});

const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof MenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.RadioItem ref={ref} className={cn(itemBase, 'ps-8', className)} {...props}>
      <span className="absolute start-2 inline-flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle aria-hidden="true" className="size-2! fill-current" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
});

const DropdownMenuLabel = forwardRef<
  ElementRef<typeof MenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <MenuPrimitive.Label
      ref={ref}
      className={cn('px-3 py-1.5 text-xs font-semibold text-fg-muted', className)}
      {...props}
    />
  );
});

const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof MenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <MenuPrimitive.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
});

/**
 * Menu on Radix DropdownMenu (user menu, row actions, locale menu): opens with Enter/Space/ArrowDown,
 * roving focus, typeahead; `dir` comes from `DirectionProvider`, so sub-menus open toward inline-end.
 */
export const DropdownMenu = {
  Root: MenuPrimitive.Root,
  Trigger: MenuPrimitive.Trigger,
  Content: DropdownMenuContent,
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  RadioGroup: MenuPrimitive.RadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Group: MenuPrimitive.Group,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
};
