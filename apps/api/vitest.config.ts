import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@tt/config/vitest/base';

// SWC (not esbuild) so Nest decorators emit the metadata DI relies on.
export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
      include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
      setupFiles: ['./test/setup.ts'],
      // e2e specs share one test database and Redis index.
      fileParallelism: false,
      // Booting Nest + connecting Prisma (slow `localhost` fallback on Windows) exceeds the 5s default.
      testTimeout: 15_000,
    },
  }),
);
