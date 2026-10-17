import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

import base, { SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS, TENANCY_SQL_RESTRICTIONS } from './base.mjs';
import { LOGICAL_CSS_EXEMPT_FILES, LOGICAL_CSS_RESTRICTIONS } from './logical-css.mjs';

/** ESLint flat config for the Next.js app: base rules + Next core-web-vitals + logical CSS. */
export default defineConfig(
  base,
  nextPlugin.configs['core-web-vitals'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // App Router only (no `pages/` dir): the rule just prints "Pages directory cannot be found".
      '@next/next/no-html-link-for-pages': 'off',
      // Rule options replace, not merge: keep the base bans next to the logical-CSS one.
      'no-restricted-syntax': [
        'error',
        ...TENANCY_SQL_RESTRICTIONS,
        ...SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
        ...LOGICAL_CSS_RESTRICTIONS,
      ],
    },
  },
  {
    // `@tt/contracts` bundles every zod schema and zod itself (~60 kB gzip): one value imported
    // from it into a client component blows the PRD §14.1 first-load budget. Browser-reachable
    // code imports values from the zod-free `@tt/contracts/web`; type imports are erased.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tt/contracts',
              allowTypeImports: true,
              message:
                'Import values from `@tt/contracts/web` (zod-free); `@tt/contracts` ships zod to the browser.',
            },
          ],
        },
      ],
    },
  },
  {
    files: LOGICAL_CSS_EXEMPT_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...TENANCY_SQL_RESTRICTIONS,
        ...SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
      ],
    },
  },
);
