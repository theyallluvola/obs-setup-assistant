import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Run with node dev/ui-preview.mjs. This server only serves fictional data.
const fixtures = {
  demo: {
    hardware: { cpu: 'AMD Ryzen 7 7800X3D', ram: 32, cores: 8, gpus: ['NVIDIA GeForce RTX 4070'],
      available: ['nvencAv1', 'nvencH264'], canvas: 1080 },
    upload: 50
  },
  worst: {
    hardware: {
      cpu: 'Intel(R) Xeon(R) w9-3495X Workstation Processor',
      ram: 1024,
      cores: 56,
      gpus: ['NVIDIA GeForce RTX 5090 Founders Edition', 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition',
        'Intel(R) Arc(TM) Pro B60 Graphics', 'AMD Radeon PRO W7900 Dual Slot'],
      available: ['nvencAv1', 'nvencH264', 'qsvAv1', 'qsvH264', 'amfAv1', 'amfH264'],
      canvas: 1440
    },
    upload: 100000,
    ceiling: 49.123456789
  },
  empty: {},
  one: { hardware: { gpus: ['Intel(R) UHD Graphics 770'] }, upload: 1 },
  slow: { upload: 0.01 }
};

const controls = (state, ceiling) => `
  <nav id="preview-controls" aria-label="Preview data">
    <a href="?data=demo">Demo data</a>
    <a href="?data=worst">Worst case</a>
    <a href="?data=empty">Empty</a>
    <a href="?data=one">Partial scan</a>
    <a href="?data=slow">Too slow</a>
  </nav>
  <style>
    body { padding-bottom: 70px; }
    #preview-controls {
      position: fixed; inset: auto 0 8px; margin-inline: auto; width: fit-content;
      max-width: calc(100% - 16px); display: flex; flex-wrap: wrap; justify-content: center; gap: 3px;
      padding: 4px; border-radius: 12px; background: #30332f; font: 13px system-ui; z-index: 1;
    }
    #preview-controls a { padding: 5px 7px; border-radius: 8px; color: white; text-decoration: none; }
    #preview-controls [aria-current] { background: white; color: #181a18; }
  </style>
  <script>
    const previewData = ${JSON.stringify(state)};
    addEventListener('DOMContentLoaded', async () => {
      document.querySelectorAll('#preview-controls a').forEach(link => {
        if (link.search === '?data=' + previewData) link.setAttribute('aria-current', 'page');
      });
      const form = document.querySelector('#stream');
      const ceiling = ${JSON.stringify(ceiling ?? null)};
      if (ceiling !== null) form.elements.uploadCeiling.value = ceiling;
      if (previewData === 'demo' || previewData === 'worst' || previewData === 'one') {
        const scan = document.querySelector('#scan');
        const finished = new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (scan.disabled) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(scan, { attributes: true, attributeFilter: ['disabled'] });
        });
        scan.click();
        await finished;
      }
      if (previewData !== 'empty') document.querySelector('#speed').click();
    });
    const fetchApp = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (url === '/api/hardware' || url === '/api/upload') {
        url += '?data=' + encodeURIComponent(previewData);
      }
      return fetchApp(url, options);
    };
  </script>`;

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/advisor.js', ['advisor.js', 'text/javascript']],
  ['/assets/Silkscreen-Bold.ttf', ['assets/Silkscreen-Bold.ttf', 'font/ttf']],
  ['/assets/obs-setup.ico', ['assets/obs-setup.ico', 'image/x-icon']]
]);

const server = createServer(async (request, response) => {
  const local = '127.0.0.1:' + server.address().port;
  if (request.headers.host !== local) {
    response.writeHead(403).end();
    return;
  }
  const url = new URL(request.url, 'http://' + local);
  const source = url.searchParams.get('data');
  const state = Object.hasOwn(fixtures, source) ? source : 'demo';
  const fixture = fixtures[state];
  if (url.pathname === '/api/profile' && request.method === 'POST' && request.headers.origin === url.origin) {
    request.resume();
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Preview only. Open OBS Setup Assistant to create a profile.' }));
    return;
  }
  if (url.pathname === '/api/stream-test' && request.method === 'POST' && request.headers.origin === url.origin) {
    request.resume();
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Preview only. Open OBS Setup Assistant to check logs.' }));
    return;
  }
  const apis = ['/api/hardware', '/api/upload'];
  if (apis.includes(url.pathname) && request.method === 'POST' && request.headers.origin === url.origin) {
    const payload = url.pathname === '/api/hardware' ? fixture.hardware : { upload: fixture.upload };
    const hasData = payload && Object.values(payload).every(value => value !== undefined);
    response.writeHead(hasData ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(hasData ? payload : { error: 'No sample measurement is available. Enter an upload speed manually.' }));
    return;
  }
  const file = files.get(url.pathname);
  if (request.method !== 'GET' || !file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const [name, type] = file;
    const body = await readFile(new URL('../' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': /^(image|font)\//.test(type) ? type : type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(name === 'index.html' ? body.toString('utf8').replace('</body>', controls(state, fixture.ceiling) + '</body>') : body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(Number(process.env.OBS_PREVIEW_PORT || 0), '127.0.0.1', () => {
  console.log('UI preview: http://127.0.0.1:' + server.address().port + '/');
});
