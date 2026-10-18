'use client';

import { ThemeToggle, type ThemeValue } from '@nibras/ui';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

/** `localStorage` key of the stored theme (spec §2). */
export const THEME_STORAGE_KEY = 'tt-theme';

/**
 * `next-themes` applies `data-theme="light|dark"` on `<html>` before first paint with an inline
 * script; `nonce` is the request's CSP nonce (`x-nonce`, set by the proxy from T15).
 */
export function ThemeProvider({ nonce, children }: { nonce?: string; children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
      {...(nonce ? { nonce } : {})}
    >
      {children}
    </NextThemesProvider>
  );
}

function isThemeValue(value: string | undefined): value is ThemeValue {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * `ThemeToggle` bound to `next-themes`. The stored theme is only known after mount (server HTML
 * cannot read `localStorage`), so until then the toggle gets `value={undefined}`: a stable
 * `Monitor` placeholder, identical on the server and in the first client render.
 */
export function ThemeToggleClient() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ThemeToggle
      value={mounted && isThemeValue(theme) ? theme : undefined}
      onValueChange={setTheme}
      labels={{
        light: t('light'),
        dark: t('dark'),
        system: t('system'),
        toggle: t('toggle'),
        toggleCurrent: (current) => t('toggleCurrent', { theme: current }),
      }}
    />
  );
}
