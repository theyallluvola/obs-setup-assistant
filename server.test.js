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

  for (const route of ['/api/hardware', '/api/upload', '/api/profile', '/api/stream-test']) {
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

test('creates an OBS profile only for a valid local recommendation', async t => {
  let writes = 0;
  const origin = await localApp(t, {
    detect: async () => ({ available: ['nvencAv1'], encoderIds: { nvencAv1: 'obs_nvenc_av1_tex' } }),
    createProfile: async (settings, options) => {
      writes++;
      assert.equal(settings.encoderId, 'nvencAv1');
      assert.equal(settings.bitrate, 12000);
      assert.deepEqual(options.encoderIds, { nvencAv1: 'obs_nvenc_av1_tex' });
      return { name: 'Example profile' };
    }
  });
  const send = (input, requestOrigin = origin) => fetch(origin + '/api/profile', {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const input = { platform: 'youtube', content: 'gameplay', upload: 50, canvas: 1080, cores: 8,
    available: ['nvencAv1'] };
  assert.equal((await send(input, 'https://external.invalid')).status, 403);
  assert.equal((await send({ ...input, upload: -1 })).status, 400);
  assert.equal((await send({ ...input, filler: 'x'.repeat(4096) })).status, 400);
  assert.equal((await send({ ...input, upload: 0.01 })).status, 422);
  assert.equal(writes, 0);
  const response = await send(input);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { name: 'Example profile' });
  assert.equal(writes, 1);
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

test('current-profile updates require a review for the same recommendation and consume it after success', async t => {
  let writes = 0;
  const origin = await localApp(t, {
    detect: async () => ({ encoderIds: { nvencH264: 'obs_nvenc_h264_tex' } }),
    reviewProfile: async platform => {
      assert.equal(platform, 'twitch');
      return { name: 'Streaming', revision: 'internal-revision', changesOutputMode: true };
    },
    updateProfile: async (settings, revision, options) => {
      writes++;
      assert.equal(settings.encoderId, 'nvencH264');
      assert.equal(revision, 'internal-revision');
      assert.deepEqual(options.encoderIds, { nvencH264: 'obs_nvenc_h264_tex' });
      return { name: 'Streaming', backup: 'local-backup' };
    }
  });
  const settings = { platform: 'twitch', content: 'gameplay', upload: 50, canvas: 1080, cores: 8,
    available: ['nvencH264'] };
  const send = body => fetch(origin + '/api/profile', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const response = await send({ action: 'review', settings });
  assert.equal(response.status, 200);
  const review = await response.json();
  assert.equal(review.name, 'Streaming');
  assert.equal(review.changesOutputMode, true);
  assert.ok(review.token);
  assert.equal(Object.hasOwn(review, 'revision'), false);
  const update = { action: 'update', settings, token: review.token };
  assert.equal((await send({ ...update, token: 'unreviewed' })).status, 409);
  assert.equal((await send({ ...update, settings: { ...settings, canvas: 720 } })).status, 409);
  assert.equal(writes, 0);
  assert.deepEqual(await (await send(update)).json(), { name: 'Streaming', backup: 'local-backup' });
  assert.equal((await send(update)).status, 409);
  assert.equal(writes, 1);
});
