import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { DirectionProvider, type Dir } from '../direction';
import { ToastProvider } from '../toast';

export type { Dir };

export interface RenderWithDirOptions extends Omit<RenderOptions, 'wrapper'> {
  dir?: Dir;
}

/**
 * Renders `ui` as the app would in the given direction: sets `<html dir>` (the source of truth for
 * logical CSS) and wraps the tree in `DirectionProvider` (Radix) and `ToastProvider`.
 */
export function renderWithDir(
  ui: ReactElement,
  { dir = 'ltr', ...options }: RenderWithDirOptions = {},
): RenderResult {
  document.documentElement.dir = dir;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DirectionProvider dir={dir}>
        <ToastProvider labels={{ close: 'Fermer' }}>{children}</ToastProvider>
      </DirectionProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
