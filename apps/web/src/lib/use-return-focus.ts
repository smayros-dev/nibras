'use client';

import { useCallback, useMemo, useRef } from 'react';

/**
 * Focus return for dialogs that have no `Trigger` of their own (opened from a row menu or a
 * shared row button): when the dialog closes, focus goes back to the control that opened it
 * (WCAG 2.4.3). Openers are registered by key (`ref={register(id)}`) or passed directly to
 * `remember`. A detached opener (its row re-rendered away) is skipped, so the primitive's default
 * focus handling applies instead.
 */
export function useReturnFocus() {
  const openers = useRef(new Map<string, HTMLElement>());
  const target = useRef<string | HTMLElement | null>(null);

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) openers.current.set(key, el);
      else openers.current.delete(key);
    },
    [],
  );

  /** Records which opener gets focus back: a registered key or the element itself. */
  const remember = useCallback((keyOrElement: string | HTMLElement) => {
    target.current = keyOrElement;
  }, []);

  const connectedOpener = useCallback((): HTMLElement | null => {
    const t = target.current;
    const el = typeof t === 'string' ? openers.current.get(t) : t;
    return el?.isConnected ? el : null;
  }, []);

  /** For a dialog's `onCloseAutoFocus`: focuses the opener instead of the default target. */
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      const opener = connectedOpener();
      if (!opener) return;
      event.preventDefault();
      opener.focus();
    },
    [connectedOpener],
  );

  /** For components without `onCloseAutoFocus`: focuses the opener when they close. */
  const focusOpener = useCallback(() => {
    connectedOpener()?.focus();
  }, [connectedOpener]);

  return useMemo(
    () => ({ register, remember, onCloseAutoFocus, focusOpener }),
    [register, remember, onCloseAutoFocus, focusOpener],
  );
}
