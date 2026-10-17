import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RSC boundary guard. Components without `'use client'` render as server components when a server
 * page uses them, and a server component cannot hand a function to a client component (Radix
 * primitives, `Slot`, …): Next fails the whole page with "Event handlers cannot be passed to Client
 * Component props". `react-dom/server` does not model that boundary, so a render test would pass
 * while the page crashes; this scan catches the pattern at its source instead. A file that sets an
 * event handler owns interaction logic and must be a client component.
 */
const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/;
const HANDLER_ATTR = /\son[A-Z]\w*=\{/;

describe('client boundary', () => {
  const files = sources(SRC);

  it('finds the component sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("every component that sets an event handler is marked 'use client'", () => {
    const offenders = files
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return !USE_CLIENT.test(text) && HANDLER_ATTR.test(text);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it.each(['button.tsx', 'checkbox.tsx'])('%s is a client component', (name) => {
    expect(readFileSync(join(SRC, name), 'utf8')).toMatch(USE_CLIENT);
  });
});
