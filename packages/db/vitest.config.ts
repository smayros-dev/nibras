import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@tt/config/vitest/base';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      setupFiles: ['./vitest.setup.ts'],
      // Spec files share `tt_db_test` (TRUNCATE-based resets): run them one at a time.
      fileParallelism: false,
    },
  }),
);
