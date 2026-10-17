import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `renderWithDir` sets `<html dir>`; reset it so direction never leaks between tests.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
});
