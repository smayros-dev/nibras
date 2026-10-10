import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@tt/config/vitest/base';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    // SWC keeps decorator metadata, which esbuild drops (Nest DI needs it).
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.e2e-spec.ts'],
      setupFiles: ['./vitest.setup.ts'],
      // Specs share the Redis DB index from REDIS_URL: run files one after another.
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }),
);
