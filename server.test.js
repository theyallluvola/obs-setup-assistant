import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from './server.js';

async function localApp(t, services) {
  const server = createServer(services);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('loads the offline page without detection or network tests and restricts both controls to the local origin', async t => {
  let scans = 0;
  let uploads = 0;
  const origin = await localApp(t, {
    detect: async () => { scans++; return { cpu: 'Fictional CPU' }; },
    measure: async () => { uploads++; return { upload: 50 }; }
  });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /Cloudflare receives your IP address/);

  for (const route of ['/api/hardware', '/api/upload']) {
    assert.equal((await fetch(origin + route)).status, 405);
    assert.equal((await fetch(origin + route, { method: 'POST' })).status, 403);
    assert.equal((await fetch(origin + route, {
      method: 'POST', headers: { Origin: 'https://external.invalid' }
    })).status, 403);
  }
  assert.equal(scans, 0);
  assert.equal(uploads, 0);
  const options = { method: 'POST', headers: { Origin: origin } };
  assert.deepEqual(await (await fetch(origin + '/api/hardware', options)).json(), { cpu: 'Fictional CPU' });
  assert.deepEqual(await (await fetch(origin + '/api/upload', options)).json(), { upload: 50 });
  assert.equal(scans, 1);
  assert.equal(uploads, 1);
});

test('disconnecting the browser cancels its upload test', async t => {
  let started;
  let canceled;
  const measuring = new Promise(resolve => { started = resolve; });
  const aborted = new Promise(resolve => { canceled = resolve; });
  const origin = await localApp(t, {
    measure: async signal => {
      signal.addEventListener('abort', () => canceled(), { once: true });
      started();
      await aborted;
      signal.throwIfAborted();
    }
  });
  const control = new AbortController();
  const response = fetch(origin + '/api/upload', {
    method: 'POST', headers: { Origin: origin }, signal: control.signal
  });
  await measuring;
  control.abort();
  await assert.rejects(response, { name: 'AbortError' });
  await aborted;
});
