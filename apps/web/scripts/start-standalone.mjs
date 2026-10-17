// Runs the production build exactly as the container does (infra/docker/web.Dockerfile):
// `output: 'standalone'` refuses `next start`, and the standalone server needs `public/` and
// `.next/static` copied next to it. Used by the e2e suite in CI and with `E2E_PROD=1`.
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(web, '.next', 'standalone');
const appDir = join(standalone, 'apps', 'web');
const server = join(appDir, 'server.js');

if (!existsSync(server)) {
  console.error(
    `start-standalone: ${server} is missing — run \`pnpm --filter @tt/web build\` first.`,
  );
  process.exit(1);
}

cpSync(join(web, 'public'), join(appDir, 'public'), { recursive: true });
cpSync(join(web, '.next', 'static'), join(appDir, '.next', 'static'), { recursive: true });

const child = spawn(process.execPath, [server], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, PORT: '3000', HOSTNAME: '127.0.0.1' },
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
