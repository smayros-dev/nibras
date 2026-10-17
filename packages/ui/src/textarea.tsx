import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';
import { CONTROL_CLASSES } from './input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /**
   * Grows with the content through CSS `field-sizing: content` (no script, no inline style, so it
   * stays CSP-clean); browsers without support keep the `rows` height, scroll and stay manually resizable.
   */
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, autoResize = false, rows = 3, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_CLASSES,
        'resize-y',
        // Manual resize stays available where `field-sizing` is unsupported.
        autoResize && 'field-sizing-content min-h-20 supports-[field-sizing:content]:resize-none',
        className,
      )}
      {...props}
    />
  );
});
