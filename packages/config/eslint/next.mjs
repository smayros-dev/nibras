import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

import base from './base.mjs';

/** ESLint flat config for the Next.js app: base rules + Next core-web-vitals. */
export default defineConfig(base, nextPlugin.configs['core-web-vitals'], {
  languageOptions: {
    globals: { ...globals.browser, ...globals.node },
  },
  rules: {
    // App Router only (no `pages/` dir): the rule just prints "Pages directory cannot be found".
    '@next/next/no-html-link-for-pages': 'off',
  },
});
