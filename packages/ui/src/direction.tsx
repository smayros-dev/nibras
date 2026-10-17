'use client';

import { Direction } from 'radix-ui';
import type { FC, ReactNode } from 'react';

export type Dir = 'ltr' | 'rtl';

export interface DirectionProviderProps {
  dir: Dir;
  children?: ReactNode;
}

/**
 * Gives Radix primitives the document direction (menus, sub-menus, toasts, sliders follow it).
 * The web root layout renders it with the locale's `dirOf(locale)`, next to `<html dir>`.
 */
export const DirectionProvider: FC<DirectionProviderProps> = Direction.Provider;

/** The direction from the nearest `DirectionProvider` (`ltr` without one). */
export const useDirection: (localDir?: Dir) => Dir = Direction.useDirection;
