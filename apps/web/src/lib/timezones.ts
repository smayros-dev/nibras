'use client';

import { useEffect, useState } from 'react';

/** PRD §8.1.1 regions, pinned on top of every time-zone list. */
export const PRD_TIMEZONES = [
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Casablanca',
  'Europe/Paris',
  'UTC',
] as const;

function withInitial(list: readonly string[], initial: string | undefined): string[] {
  return initial && !list.includes(initial) ? [initial, ...list] : [...list];
}

function runtimeTimezones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

function resolvedTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Time-zone options that hydrate cleanly (audit #7): the server and the first client render both
 * return the static PRD list (plus `initial` when not listed); after mount the list switches to the
 * runtime's `Intl.supportedValuesOf('timeZone')` (PRD zones first) and `resolved` is the browser's
 * own zone. Node's ICU and the browser's disagree, so neither may be read during render.
 */
export function useTimezones(initial?: string): {
  options: string[];
  resolved: string | null;
  ready: boolean;
} {
  const [runtime, setRuntime] = useState<{ list: string[]; resolved: string | null } | null>(null);
  useEffect(() => {
    const resolved = resolvedTimezone();
    const list = [...PRD_TIMEZONES, ...runtimeTimezones()];
    if (resolved) list.push(resolved);
    setRuntime({ list: Array.from(new Set(list)), resolved });
  }, []);

  return {
    options: withInitial(runtime?.list ?? PRD_TIMEZONES, initial),
    resolved: runtime?.resolved ?? null,
    ready: runtime !== null,
  };
}
