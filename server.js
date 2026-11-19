import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectHardware } from './hardware.js';
import { measureUpload, UploadLimitError } from './upload.js';

const pages = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/advisor.js', ['advisor.js', 'text/javascript']]
]);

export function createServer({ detect = detectHardware, measure = measureUpload } = {}) {
  let measuring = false;
  return http.createServer(async (req, res) => {
    const host = '127.0.0.1:' + req.socket.localPort;
    function send(code, body, type = 'application/json') {
      res.writeHead(code, {
        'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      });
      res.end(body);
    }
    if (req.headers.host !== host) return send(403, '{"error":"Use the local address printed by the launcher."}');
    if (req.url === '/api/hardware' || req.url === '/api/upload') {
      if (req.method !== 'POST') return send(405, '{"error":"Use the control on the local page."}');
      if (req.headers.origin !== 'http://' + host) return send(403, '{"error":"Open the app locally to use this control."}');
    }
    if (req.url === '/api/hardware') {
      try {
        return send(200, JSON.stringify(await detect()));
      } catch {
        return send(500, '{"error":"Hardware detection unavailable."}');
      }
    }
    if (req.url === '/api/upload') {
      if (measuring) return send(409, '{"error":"An upload test is already running."}');
      measuring = true;
      const test = new AbortController();
      res.once('close', () => test.abort());
      try {
        const measurement = await measure(test.signal);
        if (!res.destroyed) return send(200, JSON.stringify(measurement));
      } catch (error) {
        if (res.destroyed) return;
        const message = error instanceof UploadLimitError ? error.message :
          'The upload test could not finish. Enter a steady upload result manually.';
        return send(502, JSON.stringify({ error: message }));
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createServer();
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
}
