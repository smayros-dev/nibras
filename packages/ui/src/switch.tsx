import { Switch as SwitchPrimitive } from 'radix-ui';
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from './cn';

type RootProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export interface SwitchProps extends Omit<RootProps, 'children'> {
  label: ReactNode;
  description?: ReactNode;
}

/**
 * Radix switch with its label (≥ 44 px row). The thumb starts at inline-start and moves with
 * `translate-x` — not a physical utility — mirrored by the `rtl:` variant (PRD §8.16.1).
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, description, className, ...props },
  ref,
) {
  const descriptionId = useId();
  return (
    <div className="flex flex-col">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
        <span className="text-fg">{label}</span>
        <SwitchPrimitive.Root
          ref={ref}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent bg-border-strong',
            'transition-colors duration-fast ease-out data-[state=checked]:bg-primary',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          <SwitchPrimitive.Thumb
            className={cn(
              'pointer-events-none block size-5 rounded-full bg-surface shadow-sm',
              'transition-transform duration-fast ease-out',
              'translate-x-0 data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5',
            )}
          />
        </SwitchPrimitive.Root>
      </label>
      {/* Outside the label so it describes the control instead of joining its name. */}
      {description ? (
        <p id={descriptionId} className="-mt-1 text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
});
