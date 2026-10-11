/* eslint-disable no-restricted-syntax -- the fixtures below are the forbidden shapes under test */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import base from './base.mjs';
import nest from './nest.mjs';

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
      "export const s = \"SET LOCAL app.bypass_tenant = 'on'\";\n",
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
