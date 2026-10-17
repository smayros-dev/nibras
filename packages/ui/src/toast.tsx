'use client';

import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { useDirection, type Dir } from './direction';

export type ToastVariant = 'success' | 'danger' | 'info';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss (defaults to the provider's). */
  duration?: number;
}

export interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

type SwipeDirection = NonNullable<
  ComponentPropsWithoutRef<typeof ToastPrimitive.Provider>['swipeDirection']
>;

/**
 * Toasts are swiped away toward inline-end. Radix's `swipeDirection` is physical by API design, so
 * this is the single place where the direction maps to a physical side.
 */
export function swipeDirectionFor(dir: Dir): SwipeDirection {
  // eslint-disable-next-line no-restricted-syntax -- Radix swipe API values, not CSS classes (see above).
  return dir === 'rtl' ? 'left' : 'right';
}

const VARIANTS: Record<ToastVariant, { icon: LucideIcon; classes: string }> = {
  success: { icon: CircleCheck, classes: 'border-s-success [&>svg]:text-success' },
  danger: { icon: CircleAlert, classes: 'border-s-danger [&>svg]:text-danger' },
  info: { icon: Info, classes: 'border-s-info [&>svg]:text-info' },
};

const MAX_TOASTS = 5;

interface ToastItem extends ToastOptions {
  id: number;
  open: boolean;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /**
   * Translated by the caller: `close` names each close button, `region` names the notifications
   * landmark (the viewport), `toast` is the spoken prefix announced before each toast's text.
   */
  labels: { close: string; region: string; toast: string };
  /** Defaults to inline-end from the `DirectionProvider`. */
  swipeDirection?: SwipeDirection;
  duration?: number;
}

/**
 * Hosts the toast queue and viewport (bottom, inline-end; full width minus the gutter below `sm`).
 * `danger` toasts are announced assertively (Radix `foreground`), the others politely.
 */
export function ToastProvider({
  children,
  labels,
  swipeDirection,
  duration = 5000,
}: ToastProviderProps) {
  const dir = useDirection();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, open: false } : item)));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((prev) => [
      ...prev.filter((item) => item.open).slice(-(MAX_TOASTS - 1)),
      { ...options, id, open: true },
    ]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider
        swipeDirection={swipeDirection ?? swipeDirectionFor(dir)}
        duration={duration}
        label={labels.toast}
      >
        {children}
        {items.map(({ id, open, title, description, variant = 'info', duration: own }) => {
          const { icon: Icon, classes } = VARIANTS[variant];
          return (
            <ToastPrimitive.Root
              key={id}
              open={open}
              onOpenChange={(next) => {
                if (!next) dismiss(id);
              }}
              type={variant === 'danger' ? 'foreground' : 'background'}
              {...(own === undefined ? {} : { duration: own })}
              className={cn(
                'relative flex w-full items-start gap-3 rounded-md border border-s-4 border-border bg-surface-raised',
                'py-3 ps-4 pe-12 text-sm text-fg shadow-lg',
                'data-[state=open]:animate-toast-in data-[state=closed]:animate-fade-out',
                'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
                'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform',
                // The end offset carries the sign of the swipe, so it is correct in both directions.
                'data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=end]:animate-fade-out',
                classes,
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <div className="flex flex-col gap-1">
                <ToastPrimitive.Title className="font-semibold">{title}</ToastPrimitive.Title>
                {description ? (
                  <ToastPrimitive.Description className="text-fg-muted">
                    {description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label={labels.close}
                className={cn(
                  'absolute top-0 end-0 inline-flex size-11 items-center justify-center rounded-md text-fg-muted',
                  'hover:text-fg focus-visible:outline-2 focus-visible:outline-focus',
                )}
              >
                <X aria-hidden="true" className="size-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport
          label={labels.region}
          className={cn(
            'fixed start-4 end-4 bottom-4 z-[100] m-0 flex max-h-dvh list-none flex-col gap-2 p-0 outline-none',
            'sm:start-auto sm:w-96',
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** `toast({ title, description?, variant?, duration? })` — must be under `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used within <ToastProvider>');
  return api;
}
