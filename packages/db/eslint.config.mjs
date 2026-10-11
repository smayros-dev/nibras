import base from '@tt/config/eslint/base';

export default [
  ...base,
  {
    // The one place that sets the tenant-context GUCs and builds the super-admin client.
    files: ['src/tenant.ts', 'src/tenant.test.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
