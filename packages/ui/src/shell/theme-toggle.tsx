'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Button } from '../button';
import { DropdownMenu } from '../dropdown-menu';

export type ThemeValue = 'light' | 'dark' | 'system';

const THEMES: { value: ThemeValue; icon: LucideIcon }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export interface ThemeToggleProps {
  /**
   * The current choice; `undefined` while it is unknown (next-themes reads `localStorage` after
   * mount): the trigger then shows a stable `Monitor` placeholder so the server HTML and the first
   * client render match.
   */
  value: ThemeValue | undefined;
  onValueChange: (value: ThemeValue) => void;
  /**
   * Translated by the caller. `toggle` names the trigger while the value is unknown;
   * `toggleCurrent(label)` names it once known, including the current choice ("Thème : Système").
   */
  labels: Record<ThemeValue, string> & {
    toggle: string;
    toggleCurrent?: (current: string) => string;
  };
}

function isTheme(value: string): value is ThemeValue {
  return THEMES.some((theme) => theme.value === value);
}

/** Light / dark / system menu; the trigger shows the current choice's icon. */
export function ThemeToggle({ value, onValueChange, labels }: ThemeToggleProps) {
  const Current = THEMES.find((theme) => theme.value === value)?.icon ?? Monitor;
  const name =
    value === undefined
      ? labels.toggle
      : (labels.toggleCurrent?.(labels[value]) ?? `${labels.toggle}: ${labels[value]}`);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={name}>
          <Current aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          value={value ?? ''}
          onValueChange={(next) => {
            if (isTheme(next)) onValueChange(next);
          }}
        >
          {THEMES.map(({ value: theme, icon: Icon }) => (
            <DropdownMenu.RadioItem key={theme} value={theme}>
              <Icon aria-hidden="true" />
              {labels[theme]}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
