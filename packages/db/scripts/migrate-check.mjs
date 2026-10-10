// `prisma migrate diff --exit-code` with the shadow DB taken from DATABASE_URL_SYSTEM.
// A Node wrapper because `$VAR` in a package.json script does not expand under cmd.exe (pnpm's Windows shell).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const shadowUrl = process.env.DATABASE_URL_SYSTEM;
if (!shadowUrl) {
  console.error('migrate:check: DATABASE_URL_SYSTEM is not set');
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
