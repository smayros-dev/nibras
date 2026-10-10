import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from './vitest/base';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({ test: { include: ['vitest/**/*.test.ts'] } }),
);
