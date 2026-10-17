import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useReturnFocus } from './use-return-focus';

function button(label: string) {
  const el = document.createElement('button');
  el.textContent = label;
  document.body.append(el);
  return el;
}

function closeEvent() {
  return new Event('closeautofocus', { cancelable: true });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('useReturnFocus', () => {
  it('returns focus to the registered opener of the remembered key and cancels the default', () => {
    const { result } = renderHook(() => useReturnFocus());
    const a = button('a');
    const b = button('b');
    result.current.register('a')(a);
    result.current.register('b')(b);
    result.current.remember('b');

    const event = closeEvent();
    result.current.onCloseAutoFocus(event);

    expect(document.activeElement).toBe(b);
    expect(event.defaultPrevented).toBe(true);
  });

  it('accepts the opener element itself', () => {
    const { result } = renderHook(() => useReturnFocus());
    const opener = button('opener');
    result.current.remember(opener);

    result.current.focusOpener();

    expect(document.activeElement).toBe(opener);
  });

  it('leaves the default behaviour alone when the opener is gone', () => {
    const { result } = renderHook(() => useReturnFocus());
    const a = button('a');
    result.current.register('a')(a);
    result.current.remember('a');
    a.remove();

    const event = closeEvent();
    result.current.onCloseAutoFocus(event);
    expect(event.defaultPrevented).toBe(false);

    result.current.register('a')(null);
    result.current.onCloseAutoFocus(closeEvent());
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing before anything was remembered', () => {
    const { result } = renderHook(() => useReturnFocus());
    result.current.register('a')(button('a'));

    const event = closeEvent();
    result.current.onCloseAutoFocus(event);
    result.current.focusOpener();

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps stable callbacks across renders', () => {
    const { result, rerender } = renderHook(() => useReturnFocus());
    const first = result.current;
    rerender();
    expect(result.current.onCloseAutoFocus).toBe(first.onCloseAutoFocus);
    expect(result.current.focusOpener).toBe(first.focusOpener);
    expect(result.current.remember).toBe(first.remember);
    expect(result.current.register).toBe(first.register);
  });
});
