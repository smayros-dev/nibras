import { baseVitestConfig } from '@nibras/config/vitest/base';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      setupFiles: ['./test-setup.ts'],
      // The S3 suite talks to MinIO (multipart, a 2 s presigned-URL expiry).
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  }),
);
