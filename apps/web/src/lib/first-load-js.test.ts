import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstLoadJs } from '../../scripts/first-load-js.mjs';

const PAGE = '/[locale]/(app)/app/(home)/page';

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe('firstLoadJs (PRD §14.1 budget)', () => {
  let next: string;
  beforeEach(() => {
    next = mkdtempSync(join(tmpdir(), 'first-load-'));
    const pageDir = 'server/app/[locale]/(app)/app/(home)';
    write(
      next,
      `${pageDir}/page/build-manifest.json`,
      JSON.stringify({
        polyfillFiles: ['static/chunks/polyfill.js'],
        rootMainFiles: ['static/chunks/main.js', 'static/chunks/runtime.js'],
      }),
    );
    write(
      next,
      `${pageDir}/page_client-reference-manifest.js`,
      `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST[${JSON.stringify(PAGE)}] = ${JSON.stringify({
        entryJSFiles: {
          layout: ['static/chunks/layout.js', 'static/chunks/shared.js'],
          page: ['static/chunks/shared.js', 'static/chunks/page.js'],
        },
      })};`,
    );
    for (const name of ['polyfill', 'main', 'runtime', 'layout', 'shared', 'page'])
      write(next, `static/chunks/${name}.js`, `/* ${name} */ ${'x'.repeat(100)}`);
  });
  afterEach(() => rmSync(next, { recursive: true, force: true }));

  it('sums the gzip size of the root main files and every segment entry, once each', () => {
    const result = firstLoadJs(next, PAGE);
    expect(result.files.sort()).toEqual(
      ['main', 'runtime', 'layout', 'shared', 'page'].map((n) => `static/chunks/${n}.js`).sort(),
    );
    const expected = ['main', 'runtime', 'layout', 'shared', 'page']
      .map((n) => gzipSync(`/* ${n} */ ${'x'.repeat(100)}`).length)
      .reduce((a, b) => a + b, 0);
    expect(result.gzipBytes).toBe(expected);
  });

  it('fails loudly when the route has not been built', () => {
    expect(() => firstLoadJs(next, '/[locale]/missing/page')).toThrow(/next build/);
  });
});
