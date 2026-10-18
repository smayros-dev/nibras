// `prisma migrate dev` with extra arguments, e.g. `pnpm --filter @nibras/db migrate:dev -- --name x --create-only`.
// pnpm forwards the `--` separator literally, and Prisma would treat everything after it as
// positional (dropping `--name`), so this wrapper strips it. Run through `dotenv -e ../../.env`.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const { status } = spawnSync(process.execPath, [prismaCli, 'migrate', 'dev', ...args], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
