/* eslint-disable no-restricted-syntax -- the fixtures below are the forbidden shapes under test */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import base from './base.mjs';
import nestConfig from './nest.mjs';
import { PHYSICAL_CLASS, RTL_FLIP_ALLOWED } from './logical-css.mjs';
import nextConfig from './next.mjs';

// The fixtures are virtual files the TypeScript project service cannot load: lint them with the
// nest config minus its type-aware layer (checked on its own below).
const nest = [
  ...nestConfig,
  {
    languageOptions: { parserOptions: { projectService: false } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
];

// The next config has no type-aware layer; the alias keeps the intent explicit at call sites.
const nextWithoutTypes = nextConfig;

// Lints in-memory fixtures with the shared configs (no config file lookup); paths are virtual and
// resolved against this directory, as an app's own eslint.config.mjs would resolve them.
async function ruleIds(config, code, filePath) {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: config,
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

describe('tenancy lint restrictions', () => {
  it('bans $queryRawUnsafe / $executeRawUnsafe everywhere', async () => {
    const code = 'export const f = (db) => [db.$queryRawUnsafe("x"), db.$executeRawUnsafe("y")];\n';
    expect(await ruleIds(base, code, 'src/a.ts')).toEqual([
      'no-restricted-properties',
      'no-restricted-properties',
    ]);
    expect(await ruleIds(nest, code, 'src/admin/a.ts')).toEqual([
      'no-restricted-properties',
      'no-restricted-properties',
    ]);
  });

  it('bans hand-written set_config / app.workspace_id / app.bypass_tenant SQL, also in admin and tests', async () => {
    const fixtures = [
      "export const q = (db) => db.$executeRaw`SELECT set_config('app.workspace_id', ${'x'}, true)`;\n",
      'export const s = "SET LOCAL app.bypass_tenant = \'on\'";\n',
      "export const t = `SELECT current_setting('app.workspace_id')`;\n",
    ];
    for (const code of fixtures) {
      expect(await ruleIds(base, code, 'src/a.ts')).toEqual(['no-restricted-syntax']);
      expect(await ruleIds(nest, code, 'src/admin/a.ts')).toEqual(['no-restricted-syntax']);
      expect(await ruleIds(nest, code, 'test/a.e2e-spec.ts')).toEqual(['no-restricted-syntax']);
    }
  });

  it("allows crossTenantDb({ reason: 'super_admin' }) only under src/admin and tests", async () => {
    const code =
      "import { crossTenantDb } from '@tt/db';\n" +
      "export const q = () => crossTenantDb({ reason: 'super_admin', actor: { userId: 'u', requestId: 'r' } });\n" +
      "export const ok = () => crossTenantDb().membership.findMany({ where: { userId: 'u' } });\n";
    expect(await ruleIds(nest, code, 'src/me/me.service.ts')).toEqual(['no-restricted-syntax']);
    expect(await ruleIds(nest, code, 'src/admin/admin.service.ts')).toEqual([]);
    expect(await ruleIds(nest, code, 'test/admin.e2e-spec.ts')).toEqual([]);
    expect(await ruleIds(nest, code, 'src/admin/admin.service.spec.ts')).toEqual([]);
    const aliased = "import { crossTenantDb as x } from '@tt/db';\nexport const q = () => x();\n";
    expect(await ruleIds(nest, aliased, 'src/me/me.service.ts')).toEqual(['no-restricted-syntax']);
    const member = 'export const q = (t) => t.crossTenantDb({ reason: "super_admin" });\n';
    expect(await ruleIds(base, member, 'src/a.ts')).toEqual(['no-restricted-syntax']);
  });
});

describe('nest type-aware rules', () => {
  it('turns on no-floating-promises and no-misused-promises with the project service', async () => {
    const eslint = new ESLint({
      cwd: import.meta.dirname,
      overrideConfigFile: true,
      overrideConfig: nestConfig,
    });
    const config = await eslint.calculateConfigForFile('src/a.ts');
    expect(config.languageOptions.parserOptions.projectService).toBe(true);
    expect(config.rules['@typescript-eslint/no-floating-promises']).toEqual([2]);
    expect(config.rules['@typescript-eslint/no-misused-promises']).toEqual([
      2,
      { checksVoidReturn: false },
    ]);
  });
});

describe('logical CSS rule', () => {
  it('flags physical utilities in class strings and template literals under the next config', async () => {
    const code =
      "export const a = 'ml-2 pr-4'; export const b = `text-left ${x}`; export const ok = 'ps-2 pe-4 text-start rtl:-scale-x-100';\n";
    const ids = await ruleIds(nextWithoutTypes, code, 'src/a.tsx');
    expect(ids).toEqual(['no-restricted-syntax', 'no-restricted-syntax']);
  });

  it('flags variant-prefixed, negative and corner forms but not logical ones', async () => {
    const bad = [
      "export const a = 'md:-mr-4';\n",
      "export const a = 'rounded-tl-lg';\n",
      "export const a = 'border-l';\n",
      "export const a = 'left-0';\n",
      "export const a = 'float-right';\n",
    ];
    for (const code of bad) {
      expect(await ruleIds(nextWithoutTypes, code, 'src/a.tsx')).toEqual(['no-restricted-syntax']);
    }
    const ok =
      "export const a = 'ms-2 me-4 start-0 end-0 rounded-s border-e text-end inset-y-0 scale-x-100 rtl:-scale-x-100';\n";
    expect(await ruleIds(nextWithoutTypes, ok, 'src/a.tsx')).toEqual([]);
    expect(PHYSICAL_CLASS.test(RTL_FLIP_ALLOWED)).toBe(false);
  });

  it('flags origin, background/object position, clear, scroll padding and left/right gradients', async () => {
    const bad = [
      'origin-left',
      'origin-top-right',
      'rtl:origin-bottom-left',
      'bg-left',
      'bg-right-top',
      'object-left',
      'object-right-bottom',
      'clear-left',
      'clear-right',
      'scroll-pl-4',
      'scroll-pr-2',
      'bg-linear-to-l',
      'bg-linear-to-r',
      'bg-linear-to-tr',
      'bg-linear-to-r/oklch',
      'bg-gradient-to-l',
    ];
    for (const cls of bad) {
      const code = `export const a = 'p-2 ${cls}';\n`;
      expect(await ruleIds(nextWithoutTypes, code, 'src/a.tsx'), cls).toEqual([
        'no-restricted-syntax',
      ]);
    }
    const ok =
      "export const a = 'origin-center origin-top bg-center bg-top object-center object-cover clear-both scroll-ps-4 scroll-pe-2 bg-linear-to-t bg-linear-to-b';\n";
    expect(await ruleIds(nextWithoutTypes, ok, 'src/a.tsx')).toEqual([]);
  });

  it('keeps the tenancy SQL ban alive next to it', async () => {
    const code = 'export const s = "SET LOCAL app.bypass_tenant = \'on\'";\n';
    expect(await ruleIds(nextWithoutTypes, code, 'src/a.ts')).toEqual(['no-restricted-syntax']);
  });
});

describe('logical CSS rule scope', () => {
  it('exempts test prose but keeps the tenancy ban there', async () => {
    const prose = "test('wrong code, right code enters', () => {});\n";
    expect(await ruleIds(nextWithoutTypes, prose, 'e2e/auth.spec.ts')).toEqual([]);
    expect(await ruleIds(nextWithoutTypes, prose, 'src/a.test.tsx')).toEqual([]);
    expect(await ruleIds(nextWithoutTypes, prose, 'src/a.tsx')).toEqual(['no-restricted-syntax']);
    const sql = 'export const s = "SET LOCAL app.bypass_tenant = \'on\'";\n';
    expect(await ruleIds(nextWithoutTypes, sql, 'e2e/a.spec.ts')).toEqual(['no-restricted-syntax']);
  });
});
