import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { mockRouter, navigationModuleMock } from './navigation-mock';

// Component tests never boot Next: the locale-aware navigation helpers are replaced by a mock
// whose router `mockRouter()` resets and returns.
vi.mock('../i18n/navigation', () => navigationModuleMock());

// jsdom has no ResizeObserver; Radix measures some controls (Checkbox, Switch) with it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no layout; ProseMirror (the rich-text editor) measures selections and coordinates.
if (typeof Range !== 'undefined') {
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Element.prototype.scrollIntoView ??= () => {};
  document.elementFromPoint ??= () => null;
}

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  }
  mockRouter();
});
