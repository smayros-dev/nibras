import { baseVitestConfig } from '@tt/config/vitest/base';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    esbuild: { jsx: 'automatic' },
    test: {
      // Component tests (*.test.tsx) run in jsdom; pure logic (*.test.ts) stays in node.
      // Deprecated in Vitest 3.2 in favour of `test.projects` (prints a notice); move when Vitest 4
      // lands — `projects` + `mergeConfig` concatenates the base `include` into each project.
      environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
      setupFiles: ['./src/test/setup.ts'],
      // next-intl's ESM imports `next/server` without an extension, which Node's resolver rejects;
      // inlined, Vite resolves it (proxy.test.ts).
      server: { deps: { inline: ['next-intl'] } },
    },
  }),
);
