import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  /** Translated message; rendered as a live region and marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Id of the control; generated when absent. SP1 call sites pass it with a matching child `id`. */
  htmlFor?: string;
  /** A single control element (`Input`, `Select`, `Textarea`, …). */
  children: ReactElement;
}

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
};

/**
 * Label + control + optional description and error. Clones the single child with `id`,
 * `aria-describedby` (its own, then description, then error), `aria-invalid` and `aria-required`.
 */
export function Field({ label, description, error, required, htmlFor, children }: FieldProps) {
  const generated = useId();
  const child = Children.only(children);
  const childProps = (isValidElement(child) ? child.props : {}) as ControlProps;
  const id = htmlFor ?? childProps.id ?? `${generated}-control`;
  const descriptionId = description ? `${generated}-description` : undefined;
  const errorId = error ? `${generated}-error` : undefined;
  const describedBy =
    [childProps['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  // Only defined keys: an explicit `undefined` would override what the control derives itself
  // (e.g. `<Input invalid />` sets `aria-invalid` from its own prop).
  const overrides: ControlProps = { id };
  if (describedBy) overrides['aria-describedby'] = describedBy;
  if (error) overrides['aria-invalid'] = true;
  if (required) overrides['aria-required'] = true;
  const control = cloneElement(child as ReactElement<ControlProps>, overrides);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <p id={descriptionId} className="text-sm text-fg-muted">
          {description}
        </p>
      ) : null}
      {control}
      {error ? (
        <p role="alert" id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
