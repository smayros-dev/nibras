import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@nibras/config/vitest/base';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    // SWC keeps decorator metadata, which esbuild drops (Nest DI needs it).
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.e2e-spec.ts'],
      setupFiles: ['./vitest.setup.ts'],
      // Specs share `nibras_worker_test` and Redis index 15 (vitest.setup.ts): run files one after another.
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }),
);
