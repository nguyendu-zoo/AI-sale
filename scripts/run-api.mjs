import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this file, never from the shell/pnpm working directory. In particular,
// Relative --env-file flags fail in this Windows/pnpm launch path even with a correct exec cwd.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const api = resolve(root, 'apps/api');
const envFile = resolve(root, '.env');
const command = process.argv[2];
const extraArgs = process.argv.slice(3);
const commands = {
  generate: { cwd: api, args: [resolve(api, 'node_modules/prisma/build/index.js'), 'generate', '--schema', resolve(api, 'prisma/schema.prisma')] },
  migrate: { cwd: api, args: [resolve(api, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(api, 'prisma/schema.prisma')] },
  seed: { cwd: api, args: ['--require', resolve(api, 'node_modules/ts-node/register'), resolve(api, 'prisma/seed.ts')] },
  dev: { cwd: api, args: ['--watch', '--require', resolve(api, 'node_modules/ts-node/register'), resolve(api, 'src/main.ts')] },
  start: { cwd: api, args: [resolve(api, 'dist/main.js')] },
  browser: { cwd: root, args: [resolve(root, 'scripts/browser-smoke.mjs')] },
};

const selected = Object.hasOwn(commands, command) ? commands[command] : undefined;
if (!selected) {
  process.stderr.write(`Usage: node scripts/run-api.mjs ${Object.keys(commands).join('|')}\n`);
  process.exitCode = 1;
} else if (!existsSync(envFile)) {
  process.stderr.write('Missing project .env. Run pnpm setup:env from the project root first.\n');
  process.exitCode = 1;
} else if (typeof process.loadEnvFile !== 'function') {
  process.stderr.write('This project requires Node.js 22.12+ or a supported newer LTS release.\n');
  process.exitCode = 1;
} else {
  try {
    process.loadEnvFile(envFile);
    const child = spawn(process.execPath, [...selected.args, ...extraArgs], { cwd: selected.cwd, env: process.env, stdio: 'inherit', windowsHide: true });
    const forward = (signal) => { if (child.exitCode === null && !child.killed) child.kill(signal); };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', () => { process.stderr.write('Could not start the API command. Check Node and installed dependencies.\n'); process.exitCode = 1; });
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
    });
  } catch {
    // Do not print .env contents, connection strings, or credentials on errors.
    process.stderr.write('Could not load the project .env. Check file access and format.\n');
    process.exitCode = 1;
  }
}
