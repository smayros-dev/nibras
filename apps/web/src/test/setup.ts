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

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  }
  mockRouter();
});
