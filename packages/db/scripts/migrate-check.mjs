// `prisma migrate diff --exit-code` against a dedicated shadow DB (DATABASE_URL_SHADOW).
// Prisma wipes the shadow DB on every run, so it must never be nibras or nibras_test.
// A Node wrapper because `$VAR` in a package.json script does not expand under cmd.exe (pnpm's Windows shell).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const shadowUrl = process.env.DATABASE_URL_SHADOW;
if (!shadowUrl) {
  console.error('migrate:check: DATABASE_URL_SHADOW is not set');
  process.exit(1);
}
const shadowDb = new URL(shadowUrl).pathname.slice(1);
if (!shadowDb.endsWith('_shadow')) {
  console.error(`migrate:check: refusing shadow database "${shadowDb}" (name must end in _shadow)`);
  process.exit(1);
}

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const args = [
  'migrate',
  'diff',
  '--from-migrations',
  './prisma/migrations',
  '--to-schema-datamodel',
  './prisma/schema.prisma',
  '--shadow-database-url',
  shadowUrl,
  '--exit-code',
];
const { status } = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit' });
process.exit(status ?? 1);
