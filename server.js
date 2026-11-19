import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { detectHardware } from './hardware.js';

const cloudflare = 'https://speed.cloudflare.com/__up';
const pages = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/advisor.js', ['advisor.js', 'text/javascript']]
]);

async function measureUpload() {
  const buffer = randomBytes(12 * 1024 * 1024);
  async function sample(bytes) {
    const start = performance.now();
    const response = await fetch(cloudflare, {
      method: 'POST', body: buffer.subarray(0, bytes), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Upload endpoint unavailable.');
    await response.arrayBuffer();
    const elapsed = performance.now() - start;
    return { elapsed, mbps: bytes * 8 / elapsed / 1000 };
  }
  await sample(128 * 1024);
  const first = await sample(1024 * 1024);
  const size = first.elapsed > 1700 ? 1024 * 1024 : first.elapsed > 420 ? 4 * 1024 * 1024 : buffer.length;
  const second = await sample(size);
  const comparison = size === 1024 * 1024 ? first : await sample(size);
  return { upload: Math.floor(Math.min(second.mbps, comparison.mbps) * 100) / 100 };
}

let measuring = false;
const server = http.createServer(async (req, res) => {
  const host = '127.0.0.1:' + server.address().port;
  function send(code, body, type = 'application/json') {
    res.writeHead(code, {
      'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY'
    });
    res.end(body);
  }
  if (req.headers.host !== host) return send(403, '{"error":"Use the local address printed by the launcher."}');
  if (req.url === '/api/hardware' && req.method === 'GET') {
    return send(200, JSON.stringify(await detectHardware()));
  }
  if (req.url === '/api/upload' && req.method === 'POST') {
    if (req.headers.origin !== 'http://' + host) return send(403, '{"error":"Open the app locally to run this test."}');
    if (measuring) return send(409, '{"error":"An upload test is already running."}');
    measuring = true;
    try {
      return send(200, JSON.stringify(await measureUpload()));
    } catch {
      return send(502, '{"error":"Upload test unavailable. Enter a result from your speed test instead."}');
    } finally {
      measuring = false;
    }
  }
  const page = pages.get(req.url);
  if (req.method !== 'GET' || !page) return send(404, '{"error":"Page unavailable."}');
  try {
    const [file, type] = page;
    return send(200, await readFile(new URL(file, import.meta.url)), type);
  } catch {
    return send(500, '{"error":"Could not load the app."}');
  }
});

const port = Number(process.env.OBS_ASSISTANT_PORT || 0);
server.listen(port, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('OBS Setup Assistant: ' + url);
  console.log('Keep this window open while using the app. Press Ctrl+C to stop.');
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const browser = spawn('cmd.exe', ['/d', '/c', 'start', '""', url], {
      windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore'
    });
    browser.on('error', () => console.log('Open the address above in your browser.'));
  }
});
