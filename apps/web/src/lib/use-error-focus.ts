'use client';

import { useEffect, useRef } from 'react';

/**
 * Focus after a failed submit (WCAG 3.3.1): once the errors are rendered, focus moves to the
 * first `aria-invalid` control of `formRef`'s form or, for a form-level error, to the error alert
 * (`alertRef`, rendered with `tabIndex={-1}`). Each failed submit sets fresh error state (a new
 * object or a string after `null`), so the effect runs again on a repeated failure.
 */
export function useErrorFocus(
  fieldErrors: Record<string, string> | undefined,
  formError: string | null,
) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hasFieldErrors = fieldErrors !== undefined && Object.keys(fieldErrors).length > 0;
    if (!hasFieldErrors && !formError) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? alertRef.current)?.focus();
  }, [fieldErrors, formError]);
  return { formRef, alertRef };
}
