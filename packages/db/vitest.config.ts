import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@tt/config/vitest/base';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      setupFiles: ['./vitest.setup.ts'],
    },
  }),
);
