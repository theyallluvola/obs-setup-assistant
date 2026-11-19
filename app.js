import { encoders, recommend, formatSettings } from './advisor.js';

const form = document.querySelector('#stream');
const hardwareLabel = document.querySelector('#hardware');
const network = document.querySelector('#network');
const result = document.querySelector('#result');
const copy = document.querySelector('#copy');
const scan = document.querySelector('#scan');
const speed = document.querySelector('#speed');
const copyStatus = document.querySelector('#copy-status');
let hardware = {};
let recommendation;
let canvasTouched = false;

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request unavailable.');
  return payload;
}

async function probe() {
  scan.disabled = true;
  hardwareLabel.textContent = 'Checking your hardware…';
  try {
    hardware = await api('/api/hardware');
    hardwareLabel.replaceChildren();
    const details = [
      [hardware.cpu, hardware.ram ? hardware.ram + ' GB RAM' : ''].filter(Boolean).join(' · '),
      hardware.gpus.join(' / '),
      hardware.available.map(id => encoders[id]).filter(Boolean).join(' · ') ||
        'No hardware encoder confirmed. Select one manually if OBS lists it.'
    ].filter(Boolean);
    for (const detail of details) {
      const line = document.createElement('span');
      line.textContent = detail;
      hardwareLabel.append(line);
    }
    if (!canvasTouched && [...form.elements.canvas.options].some(option => Number(option.value) === hardware.canvas)) {
      form.elements.canvas.value = hardware.canvas;
    }
  } catch {
    hardwareLabel.textContent = 'Hardware scan unavailable. Select your encoder manually to continue.';
  } finally {
    scan.disabled = false;
  }
}

speed.addEventListener('click', async () => {
  speed.disabled = true;
  network.textContent = 'Measuring your upload speed…';
  try {
    const measurement = await api('/api/upload', { method: 'POST' });
    form.elements.upload.value = measurement.upload;
    network.textContent = 'Measured ' + measurement.upload + ' Mbps upload to Cloudflare.';
    form.requestSubmit();
  } catch (error) {
    network.textContent = error.message;
  } finally {
    speed.disabled = false;
  }
});

function paragraph(text, className) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const method = form.elements.encoder.value;
  const available = method === 'auto' ? hardware.available || [] :
    method.endsWith('Av1') ? [method, method.replace('Av1', 'H264')] : [method];
  recommendation = recommend({
    platform: form.elements.platform.value, content: form.elements.content.value,
    upload: form.elements.upload.valueAsNumber, canvas: Number(form.elements.canvas.value),
    available, cores: hardware.cores
  });
  result.replaceChildren();
  copy.hidden = !recommendation.encoder;
  copyStatus.textContent = '';
  if (!recommendation.encoder) {
    result.append(paragraph(recommendation.reason, 'empty'));
    return;
  }
  result.append(paragraph(`${recommendation.output[1]}p${recommendation.fps}`, 'output-format'),
    paragraph(`${recommendation.bitrate.toLocaleString()} kbps · ${recommendation.encoder}`, 'output-summary'));
  const settings = [
    ['Base canvas', recommendation.canvas.join(' × ')],
    ['Output resolution', recommendation.output.join(' × ')],
    ['Frame rate', recommendation.fps + ' FPS'],
    ['Rate control', recommendation.rateControl],
    ['Keyframe interval', recommendation.keyframes + ' seconds'],
    ['Encoder preset', recommendation.preset],
    ['Streaming audio', `AAC stereo · ${recommendation.audio} kbps`]
  ];
  const list = document.createElement('dl');
  for (const [label, value] of settings) {
    const key = document.createElement('dt');
    key.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(key, description);
  }
  result.append(list,
    paragraph(recommendation.reason + ' The bitrate leaves room for upload fluctuations.', 'note'),
    paragraph('Enter these values in OBS under Settings → Video and Settings → Output → Streaming (Advanced).', 'note'),
    paragraph('Test the profile with your real scene and check dropped frames in OBS → View → Stats.', 'note'));
});

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(formatSettings(recommendation));
    copyStatus.textContent = 'Settings copied.';
  } catch {
    copyStatus.textContent = 'Clipboard unavailable. The settings are listed above.';
  }
});
form.elements.canvas.addEventListener('change', () => { canvasTouched = true; });
scan.addEventListener('click', probe);
void probe();
