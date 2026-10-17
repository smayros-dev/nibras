import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from './cn';

type RootProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export interface CheckboxProps extends Omit<RootProps, 'onChange' | 'children'> {
  label: ReactNode;
  description?: ReactNode;
  /**
   * @deprecated SP1 contract (`onChange={(e) => set(e.target.checked)}`), kept until the screens
   * migrate (T9–T13); use `onCheckedChange`.
   */
  onChange?: (event: { target: { checked: boolean } }) => void;
}

/** Radix checkbox wrapped in its `<label>`: the whole label row is a ≥ 44 px hit area. */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { label, description, onChange, onCheckedChange, className, ...props },
  ref,
) {
  const descriptionId = useId();
  return (
    <div className="flex flex-col">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
        <CheckboxPrimitive.Root
          ref={ref}
          aria-describedby={description ? descriptionId : undefined}
          onCheckedChange={(checked) => {
            onCheckedChange?.(checked);
            onChange?.({ target: { checked: checked === true } });
          }}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface text-primary-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator>
            <Check aria-hidden="true" className="size-4" strokeWidth={3} />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        <span className="text-fg">{label}</span>
      </label>
      {/* Outside the label so it describes the control instead of joining its name. */}
      {description ? (
        <p id={descriptionId} className="-mt-1 ps-8 text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
});
