import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TENANCY_SQL = /set_config\(|app\.(workspace_id|bypass_tenant)/;
const TENANCY_SQL_MESSAGE =
  'Tenant context settings (the app.* GUCs) are written only by packages/db/src/tenant.ts: use tenantDb / withTenantTx / crossTenantDb (PRD §13.3).';

/**
 * `no-restricted-syntax` entries banning hand-rolled tenant-context SQL. Packages that override
 * `no-restricted-syntax` must spread this so the ban survives (rule options replace, not merge).
 */
export const TENANCY_SQL_RESTRICTIONS = [
  { selector: `Literal[value=${TENANCY_SQL}]`, message: TENANCY_SQL_MESSAGE },
  { selector: `TemplateElement[value.raw=${TENANCY_SQL}]`, message: TENANCY_SQL_MESSAGE },
];

const SUPER_ADMIN_MESSAGE =
  "crossTenantDb({ reason: 'super_admin', … }) is reserved for apps/api/src/admin/** (and tests); other code uses crossTenantDb() with a userId filter.";

/** The super-admin form of `crossTenantDb` (any argument) and aliasing it to dodge this rule. */
export const SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS = [
  {
    selector: "CallExpression[callee.name='crossTenantDb'][arguments.length>0]",
    message: SUPER_ADMIN_MESSAGE,
  },
  {
    selector: "CallExpression[callee.property.name='crossTenantDb'][arguments.length>0]",
    message: SUPER_ADMIN_MESSAGE,
  },
  {
    selector: "ImportSpecifier[imported.name='crossTenantDb'][local.name!='crossTenantDb']",
    message: 'Import crossTenantDb under its own name so its lint rules apply.',
  },
];

const RAW_UNSAFE_MESSAGE =
  'String-built SQL skips parameter binding: use the $queryRaw / $executeRaw tagged templates (compose with Prisma.sql / Prisma.join).';

/** Shared ESLint flat config for every TypeScript package in the monorepo. */
export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: RAW_UNSAFE_MESSAGE },
        { property: '$executeRawUnsafe', message: RAW_UNSAFE_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        ...TENANCY_SQL_RESTRICTIONS,
        ...SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS,
      ],
    },
  },
  prettier,
);
