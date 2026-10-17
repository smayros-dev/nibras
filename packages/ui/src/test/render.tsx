import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

export type Dir = 'ltr' | 'rtl';

export interface RenderWithDirOptions extends Omit<RenderOptions, 'wrapper'> {
  dir?: Dir;
}

/**
 * Renders `ui` as the app would in the given direction: sets `<html dir>` (the source of truth for
 * logical CSS) and wraps the tree in the direction context.
 * TODO(T3): wrap in `DirectionProvider` once it exists.
 */
export function renderWithDir(
  ui: ReactElement,
  { dir = 'ltr', ...options }: RenderWithDirOptions = {},
): RenderResult {
  document.documentElement.dir = dir;
  function Wrapper({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
