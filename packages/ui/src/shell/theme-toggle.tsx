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
  value: ThemeValue;
  onValueChange: (value: ThemeValue) => void;
  /** Translated by the caller; `toggle` names the trigger. */
  labels: Record<ThemeValue, string> & { toggle: string };
}

function isTheme(value: string): value is ThemeValue {
  return THEMES.some((theme) => theme.value === value);
}

/** Light / dark / system menu; the trigger shows the current choice's icon. */
export function ThemeToggle({ value, onValueChange, labels }: ThemeToggleProps) {
  const Current = THEMES.find((theme) => theme.value === value)?.icon ?? Monitor;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={labels.toggle}>
          <Current aria-hidden="true" className="size-5" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          value={value}
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
