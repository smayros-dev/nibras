'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';
import { cn } from './cn';

interface TabsContextValue {
  value: string | undefined;
  asLinks: boolean;
}

const TabsContext = createContext<TabsContextValue>({ value: undefined, asLinks: false });

type TabsPrimitiveRootProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

/**
 * Navigation tabs (`asLinks`): each trigger wraps a `<Link>` (`asChild`), so every tab is a real URL.
 * The caller must pass `value` = the current path segment (a `defaultValue` would never set
 * `aria-current`); the active link gets `aria-current="page"`. Arrow keys only move focus (manual
 * activation) and there are no panels (`Tabs.Content`).
 */
export type TabsRootProps =
  | (TabsPrimitiveRootProps & { asLinks?: false })
  | (Omit<TabsPrimitiveRootProps, 'value' | 'defaultValue'> & {
      asLinks: true;
      value: string;
      defaultValue?: never;
    });

export const TabsRoot = forwardRef<ElementRef<typeof TabsPrimitive.Root>, TabsRootProps>(
  function TabsRoot({ asLinks = false, activationMode, className, ...props }, ref) {
    return (
      <TabsContext.Provider value={{ value: props.value, asLinks }}>
        <TabsPrimitive.Root
          ref={ref}
          activationMode={asLinks ? 'manual' : activationMode}
          className={cn('flex flex-col gap-4', className)}
          {...props}
        />
      </TabsContext.Provider>
    );
  },
);

/** Scrolls horizontally on narrow screens, never wraps. */
export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'flex max-w-full gap-1 overflow-x-auto scroll-ps-4 border-b border-border',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, value, ...props }, ref) {
  const { value: current, asLinks } = useContext(TabsContext);
  // Link mode: no panels, so no `aria-controls`; anchors take no `type` (Radix sets both).
  const linkProps = asLinks
    ? {
        'aria-controls': undefined,
        type: undefined,
        'aria-current': value === current ? ('page' as const) : undefined,
      }
    : {};
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        '-mb-px inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-4',
        'text-sm font-medium whitespace-nowrap text-fg-muted transition-colors duration-fast',
        'hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'data-[state=active]:border-primary data-[state=active]:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
      {...linkProps}
    />
  );
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('focus-visible:outline-2 focus-visible:outline-focus', className)}
      {...props}
    />
  );
});

/**
 * Radix Tabs (settings and workspace sub-navigation): roving focus, arrow keys follow `dir` from
 * `DirectionProvider`. Server components must use the named exports (`TabsRoot`, …): a server
 * module cannot dot into a client export.
 */
export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
};
