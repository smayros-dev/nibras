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
