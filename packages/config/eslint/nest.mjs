import { defineConfig } from 'eslint/config';

import base, { TENANCY_SQL_RESTRICTIONS } from './base.mjs';

/** ESLint flat config for NestJS apps (api, worker): decorator/DI-friendly rules. */
export default defineConfig(
  base,
  {
    rules: {
      // Nest modules/DTOs are often decorator-only classes.
      '@typescript-eslint/no-extraneous-class': 'off',
      // DI relies on emitDecoratorMetadata: constructor param types must stay value imports.
      '@typescript-eslint/consistent-type-imports': 'off',
      // Constructor parameter properties are the idiomatic Nest injection style.
      '@typescript-eslint/parameter-properties': 'off',
      // Interfaces merged with injectable classes are common in Nest typings.
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },
  {
    // The admin console (Task 17) is the only caller of crossTenantDb({ reason: 'super_admin' }).
    // Changes here need the tenancy owner's review (PRD §13.3).
    files: ['src/admin/**', 'test/**', '**/*.spec.ts', '**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...TENANCY_SQL_RESTRICTIONS] },
  },
);
