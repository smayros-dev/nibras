import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '.');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Every client form submits through `onSubmit` + `preventDefault`, which only exists once React
 * has hydrated. A submit before that (slow network, user typing into the server-rendered inputs)
 * is a native submit: without `method="post"` it is a GET that copies every field — passwords,
 * TOTP codes — into the URL (history, proxy and server logs). With `method="post"` the fields
 * stay in the body and the page simply re-renders.
 */
describe('server-rendered forms', () => {
  it('declare method="post" so a pre-hydration submit never puts fields in the URL', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/<form\b[^>]*>/gs)) {
        if (!/\bmethod="post"/.test(match[0])) offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
