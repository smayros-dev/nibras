// First-load JS budget (PRD §14.1: initial JS of a student route < 250 KB gzip, video player
// excluded). Next 16's Turbopack build no longer prints "First Load JS", so this reads the build
// manifests instead: for a page, the root main files (framework, runtime) plus every JS chunk its
// segments (root layout, route-group layouts, loading, error, not-found, the page) load up front,
// each counted once, gzipped at level 9. The legacy polyfill chunk (`nomodule`) is not counted.
//
//   pnpm --filter @nibras/web build && pnpm --filter @nibras/web budget
//
// Checks every app page and exits 1 when one is over the budget.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 250_000;

/**
 * @param {string} nextDir the `.next` directory of a production build
 * @param {string} page an app page as Next names it, e.g. `/[locale]/(app)/app/(home)/page`
 * @returns {{ files: string[], gzipBytes: number }}
 */
export function firstLoadJs(nextDir, page) {
  const base = join(nextDir, 'server', 'app', ...page.split('/').filter(Boolean));
  const buildManifest = join(base, 'build-manifest.json');
  const clientManifest = `${base}_client-reference-manifest.js`;
  if (!existsSync(buildManifest) || !existsSync(clientManifest))
    throw new Error(`first-load-js: no build output for ${page} — run \`next build\` first.`);

  const { rootMainFiles = [] } = JSON.parse(readFileSync(buildManifest, 'utf8'));
  /** @type {{ globalThis: { __RSC_MANIFEST?: Record<string, { entryJSFiles?: Record<string, string[]> }> } }} */
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(clientManifest, 'utf8'), sandbox);
  const entries = sandbox.__RSC_MANIFEST?.[page]?.entryJSFiles ?? {};

  const files = [...new Set([...rootMainFiles, ...Object.values(entries).flat()])];
  const gzipBytes = files
    .map((file) => gzipSync(readFileSync(join(nextDir, file)), { level: 9 }).length)
    .reduce((sum, size) => sum + size, 0);
  return { files, gzipBytes };
}

function main() {
  const nextDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.next');
  const routesFile = join(nextDir, 'app-path-routes-manifest.json');
  if (!existsSync(routesFile)) {
    console.error('first-load-js: .next is missing — run `pnpm --filter @nibras/web build` first.');
    process.exit(1);
  }
  /** @type {Record<string, string>} page → route */
  const routes = JSON.parse(readFileSync(routesFile, 'utf8'));
  const rows = Object.entries(routes)
    .filter(([page]) => page.endsWith('/page') && page !== '/_not-found/page')
    .map(([page, route]) => ({ route, ...firstLoadJs(nextDir, page) }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes);

  const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
  for (const { route, gzipBytes, files } of rows)
    console.log(
      `${gzipBytes > BUDGET_BYTES ? 'OVER' : 'ok  '}  ${kb(gzipBytes).padStart(9)}  ${String(files.length).padStart(2)} chunks  ${route}`,
    );
  const over = rows.filter((row) => row.gzipBytes > BUDGET_BYTES);
  console.log(
    `budget ${kb(BUDGET_BYTES)} gzip (PRD §14.1): ${over.length ? `${over.length} route(s) over` : 'all routes within'}`,
  );
  if (over.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
