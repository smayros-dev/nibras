import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as classes from './dialog-classes';

describe('dialog class constants', () => {
  it('live in a module without the client directive, so server components get plain strings', () => {
    const source = readFileSync(join(import.meta.dirname, 'dialog-classes.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use client['"]/);
    for (const name of [
      'dialogOverlayClasses',
      'dialogPanelClasses',
      'dialogTitleClasses',
      'dialogDescriptionClasses',
    ] as const) {
      expect(typeof classes[name]).toBe('string');
    }
  });
});
