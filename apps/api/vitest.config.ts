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
      // Spec files run one at a time: they all use the same `DATABASE_URL_TEST` DB and
      // `REDIS_URL_TEST` index (mapped in test/setup.ts).
      fileParallelism: false,
      // The unreachable-DB health spec boots Nest while Prisma's connect to a closed port fails;
      // on Windows a refused connection takes ~2s per address, beyond the 5s default.
      testTimeout: 15_000,
    },
  }),
);
