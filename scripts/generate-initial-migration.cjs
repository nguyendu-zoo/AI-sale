// Development helper: writes initial migration SQL as UTF-8 (PowerShell 5 > uses UTF-16).
// Never applies a migration or modifies any database.
const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const destination = resolve('apps/api/prisma/migrations/202611160001_initial/migration.sql');
if (existsSync(destination)) throw new Error('Initial migration already exists; refusing to overwrite.');
const sql = execFileSync(process.execPath, [
  'apps/api/node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty',
  '--to-schema-datamodel', 'apps/api/prisma/schema.prisma', '--script'
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
mkdirSync(resolve('apps/api/prisma/migrations/202611160001_initial'), { recursive: true });
writeFileSync(destination, sql, 'utf8');
console.log('Initial migration generated as UTF-8; not applied to a database.');
