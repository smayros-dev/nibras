import { describe, expect, it } from 'vitest';
import { PHYSICAL_TOKEN } from './logical-classes';

describe('PHYSICAL_TOKEN', () => {
  it.each([
    'ml-2',
    'pr-4',
    'left-0',
    'rounded-tl-lg',
    'origin-left',
    'origin-top-right',
    'origin-bottom-left',
    'bg-left',
    'bg-right-bottom',
    'object-left',
    'object-right-top',
    'clear-left',
    'clear-right',
    'scroll-pl-4',
    'scroll-pr-2',
    'bg-linear-to-l',
    'bg-linear-to-r',
    'bg-linear-to-br',
    'bg-linear-to-r/oklch',
  ])('flags %s', (token) => {
    expect(PHYSICAL_TOKEN.test(token)).toBe(true);
  });

  it.each([
    'ps-2',
    'origin-center',
    'origin-top',
    'bg-center',
    'object-cover',
    'clear-both',
    'scroll-ps-4',
    'bg-linear-to-t',
    'translate-x-5',
    '-scale-x-100',
  ])('accepts %s', (token) => {
    expect(PHYSICAL_TOKEN.test(token)).toBe(false);
  });
});
