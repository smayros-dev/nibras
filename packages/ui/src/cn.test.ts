import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('lets the last conflicting utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy values and keeps logical utilities side by side', () => {
    const cond = false as boolean;
    expect(cn('ps-2', cond && 'pe-2')).toBe('ps-2');
    expect(cn('ps-2', !cond && 'pe-2')).toBe('ps-2 pe-2');
  });

  it('merges semantic colour utilities', () => {
    expect(cn('bg-surface text-fg', 'bg-primary')).toBe('text-fg bg-primary');
  });
});
