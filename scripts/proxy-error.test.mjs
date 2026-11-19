import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer, loadConfigFromFile } from '../apps/web/node_modules/vite/dist/node/index.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Vite API proxy preserves real responses and reports an unavailable backend clearly', async (t) => {
  const upstream = createHttpServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ statusCode: 401, message: 'Email hoặc mật khẩu không đúng.' }));
  });
  await new Promise((done, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', done);
  });
  const upstreamPort = upstream.address().port;
  let vite;
  try {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(project, 'apps/web/vite.config.ts'), project, 'silent');
    assert.ok(loaded, 'The real Vite configuration must load');
    const apiOptions = loaded.config.server.proxy['/api'];
    vite = await createServer({
      configFile: false,
      root: resolve(project, 'apps/web'),
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, entries: [] },
      server: {
        host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
        proxy: { '/api': { ...apiOptions, target: `http://127.0.0.1:${upstreamPort}` } },
      },
    });
    await vite.listen();
    const address = vite.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;

    await t.test('a real authentication failure remains HTTP 401', async () => {
      const response = await fetch(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { statusCode: 401, message: 'Email hoặc mật khẩu không đúng.' });
    });

    await new Promise((done, reject) => upstream.close(error => error ? reject(error) : done()));
    await t.test('a stopped backend produces HTTP 503 with a useful JSON message', async () => {
      const response = await fetch(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      assert.equal(response.status, 503);
      assert.match(response.headers.get('content-type'), /application\/json/);
      const body = await response.json();
      assert.equal(body.code, 'API_UNAVAILABLE');
      assert.match(body.message, /khởi động backend/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  } finally {
    await vite?.close();
    if (upstream.listening) await new Promise(done => upstream.close(done));
  }
});
