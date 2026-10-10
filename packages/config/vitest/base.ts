import type { ViteUserConfig } from 'vitest/config';

/** Shared Vitest settings; packages merge it with `mergeConfig(baseVitestConfig, {...})`. */
export const baseVitestConfig = {
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
  },
} satisfies ViteUserConfig;
