import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { pathToFileURL } from 'node:url';
import { encoders, recommend } from './advisor.js';
import { runDesktopBridge } from './desktop-bridge.js';
import { detectHardware } from './hardware.js';
import { createObsProfile, ObsProfileError, reviewCurrentObsProfile, updateCurrentObsProfile } from './obs-profile.js';
import { createStreamTests } from './stream-test.js';
import { measureUpload, UploadLimitError } from './upload.js';

const pages = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/advisor.js', ['advisor.js', 'text/javascript']],
  ['/assets/Silkscreen-Bold.ttf', ['assets/Silkscreen-Bold.ttf', 'font/ttf']],
  ['/assets/obs-setup.ico', ['assets/obs-setup.ico', 'image/x-icon']]
]);

async function readJsonRequest(req) {
  if (req.headers['content-type'] !== 'application/json') throw new Error();
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 4096) {
      req.resume();
      throw new Error();
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function profileRecommendation(input) {
  if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input)) > 4096) throw new Error();
  if (input.upload > 100000 || input.uploadCeiling > 100000 ||
      !Number.isInteger(input.cores) || input.cores < 0 || input.cores > 4096 ||
      !Array.isArray(input.available) || input.available.length > Object.keys(encoders).length ||
      !input.available.every(id => typeof id === 'string' && Object.hasOwn(encoders, id))) {
    throw new Error();
  }
  return recommend(input);
}

const jsonPaths = new Set(['/api/profile', '/api/stream-test']);
const apiPaths = new Set(['/api/hardware', '/api/upload', ...jsonPaths]);
const failure = (status, error) => ({ status, payload: { error } });
const invalidRecommendation = () => failure(400, 'Generate a recommendation before creating an OBS profile.');

export function createApi({ detect = detectHardware, measure = measureUpload, createProfile = createObsProfile,
  reviewProfile = reviewCurrentObsProfile, updateProfile = updateCurrentObsProfile, streamTests = createStreamTests() } = {}) {
  let measuring = false;
  let savingProfile = false;
  const profileReviews = new Map();
  return async (route, input, signal) => {
    signal.throwIfAborted();
    if (route === '/api/stream-test') {
      if (input?.action === 'start') return { status: 200, payload: await streamTests.start() };
      if (input?.action === 'check' && typeof input.id === 'string' && input.id.length === 36) {
        return { status: 200, payload: await streamTests.check(input.id, signal) };
      }
      return failure(400, 'Start a test before checking the OBS log.');
    }
    if (route === '/api/hardware') {
      try {
        const { encoderIds, ...hardware } = await detect();
        signal.throwIfAborted();
        return { status: 200, payload: hardware };
      } catch {
        signal.throwIfAborted();
        return failure(500, 'Hardware detection unavailable.');
      }
    }
    if (route === '/api/profile') {
      const action = input?.action ?? 'create';
      if (!['create', 'review', 'update'].includes(action)) return invalidRecommendation();
      const updating = action === 'update';
      const reviewing = action === 'review';
      let settings;
      try { settings = profileRecommendation(action === 'create' ? input : input.settings); }
      catch { return invalidRecommendation(); }
      if (!settings.encoderId) return failure(422, 'Get a recommendation with a video encoder first.');
      if (savingProfile) return failure(409, 'An OBS profile is already being saved.');
      const fingerprint = JSON.stringify(settings);
      const review = updating ? profileReviews.get(input.token) : undefined;
      if (updating && (!review || review.fingerprint !== fingerprint)) {
        return failure(409, 'Close this review and open it again before applying changes.');
      }
      savingProfile = true;
      try {
        if (reviewing) {
          const { name, revision, changesOutputMode } = await reviewProfile(settings.platform);
          signal.throwIfAborted();
          const token = randomUUID();
          if (profileReviews.size >= 8) profileReviews.delete(profileReviews.keys().next().value);
          profileReviews.set(token, { revision, fingerprint });
          return { status: 200, payload: { name, token, changesOutputMode } };
        }
        const { encoderIds } = await detect();
        signal.throwIfAborted();
        if (updating) {
          const profile = await updateProfile(settings, review.revision, { encoderIds });
          profileReviews.delete(input.token);
          return { status: 200, payload: profile };
        }
        const profile = await createProfile(settings, { encoderIds });
        return { status: 201, payload: { name: profile.name } };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ObsProfileError) return failure(422, error.message);
        return failure(500, 'The OBS profile request could not finish.');
      } finally {
        savingProfile = false;
      }
    }
    if (route === '/api/upload') {
      if (measuring) return failure(409, 'An upload test is already running.');
      measuring = true;
      try {
        return { status: 200, payload: await measure(signal) };
      } catch (error) {
        signal.throwIfAborted();
        return failure(502, error instanceof UploadLimitError ? error.message :
          'The upload test could not finish. Enter a steady upload result manually.');
      } finally {
        measuring = false;
      }
    }
    return failure(404, 'Request unavailable.');
  };
}

export function createServer(services) {
  const call = createApi(services);
  return http.createServer(async (req, res) => {
    const host = '127.0.0.1:' + req.socket.localPort;
    function send(code, body, type = 'application/json') {
      res.writeHead(code, {
      'Content-Type': /^(image|font)\//.test(type) ? type : type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      });
      res.end(body);
    }
    if (req.headers.host !== host) return send(403, '{"error":"Use the local address printed by the launcher."}');
    if (apiPaths.has(req.url)) {
      if (req.method !== 'POST') return send(405, '{"error":"Use the control on the local page."}');
      if (req.headers.origin !== 'http://' + host) return send(403, '{"error":"Open the app locally to use this control."}');
      const request = new AbortController();
      res.once('close', () => request.abort());
      let body;
      if (jsonPaths.has(req.url)) {
        try { body = await readJsonRequest(req); } catch {
          const { status, payload } = req.url === '/api/profile' ? invalidRecommendation() :
            failure(400, 'Start a test before checking the OBS log.');
          if (!res.destroyed) send(status, JSON.stringify(payload));
          return;
        }
      }
      try {
        const { status, payload } = await call(req.url, body, request.signal);
        if (!res.destroyed) send(status, JSON.stringify(payload));
      } catch {
        if (!res.destroyed) send(500, '{"error":"Request unavailable."}');
      }
      return;
    }
    const page = pages.get(req.url);
    if (req.method !== 'GET' || !page) return send(404, '{"error":"Page unavailable."}');
    try {
      const [file, type] = page;
      const body = isSea() ? Buffer.from(getAsset(file)) : await readFile(new URL(file, import.meta.url));
      return send(200, body, type);
    } catch {
      return send(500, '{"error":"Could not load the app."}');
    }
  });
}

function startHttpServer() {
  const server = createServer();
  const port = Number(process.env.OBS_ASSISTANT_PORT || 0);
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + server.address().port;
    console.log('OBS Setup Assistant: ' + url);
    console.log('Keep this window open while using the app. Press Ctrl+C to stop.');
    if (process.platform === 'win32' && !process.argv.includes('--no-open') && (isSea() || process.argv.includes('--open'))) {
      const browser = spawn('cmd.exe', ['/d', '/c', 'start', '""', url], {
        windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore'
      });
      browser.on('error', () => console.log('Open the address above in your browser.'));
    }
  });
}

if (isSea() || (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)) {
  if (process.argv.includes('--desktop-bridge')) {
    runDesktopBridge(createApi()).catch(() => { process.exitCode = 1; });
  } else {
    startHttpServer();
  }
}
