import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = resolve(project, '.tools/runner-tests');
mkdirSync(testRoot, { recursive: true });

function fixture(run, includeEnv = true) {
  const root = mkdtempSync(resolve(testRoot, 'project with spaces '));
  const api = resolve(root, 'apps/api');
  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  mkdirSync(resolve(api, 'node_modules/prisma/build'), { recursive: true });
  mkdirSync(resolve(api, 'prisma'), { recursive: true });
  mkdirSync(resolve(root, 'unrelated cwd'), { recursive: true });
  copyFileSync(resolve(project, 'scripts/run-api.mjs'), resolve(root, 'scripts/run-api.mjs'));
  if (includeEnv) writeFileSync(resolve(root, '.env'), 'RUNNER_ENV_FIXTURE=project-value\n');
  writeFileSync(resolve(root, 'unrelated cwd/.env'), 'RUNNER_ENV_FIXTURE=wrong-working-directory\n');
  // Exercise actual Node child execution without accessing a database or real credentials.
  writeFileSync(resolve(api, 'node_modules/prisma/build/index.js'), `
    console.log(JSON.stringify({ marker: process.env.RUNNER_ENV_FIXTURE, cwd: process.cwd(), args: process.argv.slice(2) }));
    process.exitCode = Number(process.env.RUNNER_EXIT_FIXTURE || 0);
  `);
  try { run({ root, api, runner: resolve(root, 'scripts/run-api.mjs') }); }
  finally {
    const actual = realpathSync(root);
    const allowed = realpathSync(testRoot) + sep;
    assert.ok(actual.startsWith(allowed), 'Refusing to remove fixture outside the intended test directory');
    rmSync(actual, { recursive: true });
  }
}

for (const cwd of ['.', 'apps/api', 'unrelated cwd']) {
  test(`loads the project env and executes Prisma from ${cwd}, with spaces in project path`, () => {
    fixture(({ root, api, runner }) => {
      const envPath = resolve(root, '.env');
      const before = readFileSync(envPath, 'utf8');
      const env = { ...process.env };
      delete env.RUNNER_ENV_FIXTURE;
      delete env.RUNNER_EXIT_FIXTURE;
      const result = spawnSync(process.execPath, [runner, 'generate'], { cwd: resolve(root, cwd), env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.marker, 'project-value');
      assert.equal(output.cwd, api);
      assert.deepEqual(output.args, ['generate', '--schema', resolve(api, 'prisma/schema.prisma')]);
      assert.equal(readFileSync(envPath, 'utf8'), before, 'the launcher must never modify .env');
    });
  });
}

test('preserves process environment overrides and forwards migration arguments', () => {
  fixture(({ root, api, runner }) => {
    const result = spawnSync(process.execPath, [runner, 'migrate', '--help'], { cwd: project, env: { ...process.env, RUNNER_ENV_FIXTURE: 'process-override', RUNNER_EXIT_FIXTURE: '0' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.marker, 'process-override');
    assert.deepEqual(output.args, ['migrate', 'deploy', '--schema', resolve(api, 'prisma/schema.prisma'), '--help']);
    assert.notEqual(root, project);
  });
});

test('reports missing project .env instead of reading an unrelated cwd .env', () => {
  fixture(({ root, runner }) => {
    const result = spawnSync(process.execPath, [runner, 'generate'], { cwd: resolve(root, 'unrelated cwd'), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing project \.env/);
    assert.equal(result.stdout, '');
  }, false);
});

test('propagates command failure to PowerShell and pnpm', () => {
  fixture(({ root, runner }) => {
    const result = spawnSync(process.execPath, [runner, 'generate'], { cwd: root, env: { ...process.env, RUNNER_EXIT_FIXTURE: '7' }, encoding: 'utf8' });
    assert.equal(result.status, 7);
  });
});
