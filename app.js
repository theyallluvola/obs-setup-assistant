import { encoders, recommend, formatSettings } from './advisor.js';

const form = document.querySelector('#stream');
const hardwareLabel = document.querySelector('#hardware');
const network = document.querySelector('#network');
const result = document.querySelector('#result');
const copy = document.querySelector('#copy');
const scan = document.querySelector('#scan');
const speed = document.querySelector('#speed');
const clear = document.querySelector('#clear');
const copyStatus = document.querySelector('#copy-status');
const apply = document.querySelector('#apply');
const applyStatus = document.querySelector('#apply-status');
const profileDialog = document.querySelector('#profile-dialog');
const profileSummary = document.querySelector('#profile-summary');
const profileStatus = document.querySelector('#profile-status');
const saveProfile = document.querySelector('#save-profile');
const cancelProfile = document.querySelector('#cancel-profile');
const resultTitle = document.querySelector('#result-title');
const streamTest = document.querySelector('#stream-test');
const testStart = document.querySelector('#test-start');
const testCheck = document.querySelector('#test-check');
const testFallback = document.querySelector('#test-fallback');
const testPrevious = document.querySelector('#test-previous');
const testStatus = document.querySelector('#test-status');
const hardwareHint = hardwareLabel.textContent;
const emptyPreview = result.firstElementChild.cloneNode(true);
let session = new AbortController();
let hardware = {};
let recommendation;
let recommendationInput;
let profileInput;
let canvasTouched = false;
let streamRun = {};

const desktop = window.chrome?.webview;
const pending = new Map();
let nextRequest = 0;
desktop?.addEventListener('message', ({ data }) => {
  pending.get(data.id)?.(data);
});

function desktopRequest(path, body, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const id = ++nextRequest;
    const finish = () => {
      pending.delete(id);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      try { desktop.postMessage({ cancel: id }); }
      finally { reject(signal.reason); }
    };
    pending.set(id, ({ ok, payload }) => {
      finish();
      if (ok) resolve(payload);
      else reject(new Error(payload.error || 'Request unavailable.'));
    });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      desktop.postMessage({ id, path, body });
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

async function api(path, options) {
  if (desktop) return desktopRequest(path, options.body ? JSON.parse(options.body) : null, options.signal);
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request unavailable.');
  return payload;
}

async function probe() {
  const { signal } = session;
  scan.disabled = true;
  delete hardwareLabel.dataset.state;
  hardwareLabel.textContent = 'Checking your hardware…';
  try {
    const detected = await api('/api/hardware', { method: 'POST', signal });
    if (signal.aborted) return;
    hardware = detected;
    hardwareLabel.replaceChildren();
    const details = [
      [hardware.cpu, hardware.ram ? hardware.ram + ' GB RAM' : ''].filter(Boolean).join(' · '),
      (hardware.gpus ?? []).join(' / '),
      (hardware.available ?? []).map(id => encoders[id]).filter(Boolean).join(' · ') ||
        'No hardware encoder confirmed. Select one manually if OBS lists it.'
    ].filter(Boolean);
    for (const detail of details) {
      const line = document.createElement('span');
      line.dir = 'auto';
      line.textContent = detail;
      hardwareLabel.append(line);
    }
    if (!canvasTouched && [...form.elements.canvas.options].some(option => Number(option.value) === hardware.canvas)) {
      form.elements.canvas.value = hardware.canvas;
    }
  } catch {
    if (!signal.aborted) {
      hardwareLabel.dataset.state = 'error';
      hardwareLabel.textContent = 'Hardware scan unavailable. Select your encoder manually to continue.';
    }
  } finally {
    if (!signal.aborted) scan.disabled = false;
  }
}

speed.addEventListener('click', async () => {
  const { signal } = session;
  speed.disabled = true;
  network.dataset.state = 'pending';
  network.textContent = 'Measuring sustained upload. The opening burst is excluded…';
  try {
    const measurement = await api('/api/upload', { method: 'POST', signal });
    if (signal.aborted) return;
    form.elements.upload.value = measurement.upload;
    network.dataset.state = 'success';
    network.textContent = 'Measured ' + measurement.upload.toLocaleString() + ' Mbps sustained upload to Cloudflare.';
    form.requestSubmit();
  } catch (error) {
    if (!signal.aborted) {
      network.dataset.state = 'error';
      network.textContent = error.message;
    }
  } finally {
    if (!signal.aborted) speed.disabled = false;
  }
});

function paragraph(text, className) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function settingRows(settings) {
  return settings.map(([label, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('dt');
    const description = document.createElement('dd');
    key.textContent = label;
    description.textContent = value;
    row.append(key, description);
    return row;
  });
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const method = form.elements.encoder.value;
  const available = method === 'auto' ? hardware.available || [] :
    method.endsWith('Av1') ? [method, method.replace('Av1', 'H264')] : [method];
  recommendationInput = {
    platform: form.elements.platform.value, content: form.elements.content.value,
    upload: form.elements.upload.valueAsNumber,
    uploadCeiling: form.elements.uploadCeiling.value ? form.elements.uploadCeiling.valueAsNumber : undefined,
    canvas: Number(form.elements.canvas.value),
    available, cores: hardware.cores || 0, fallbackStep: 0
  };
  renderRecommendation();
});

function resetStreamCheck() {
  streamRun = {};
  testStart.disabled = testCheck.disabled = false;
  testStart.textContent = 'Start log check';
  testCheck.hidden = true;
  testStatus.textContent = '';
  delete testStatus.dataset.state;
}

function renderRecommendation() {
  resetStreamCheck();
  recommendation = recommend(recommendationInput);
  result.replaceChildren();
  resultTitle.textContent = recommendationInput.fallbackStep ? 'Fallback settings' : 'Recommended settings';
  streamTest.hidden = !recommendation.encoder;
  testPrevious.hidden = !recommendationInput.fallbackStep;
  copy.hidden = !recommendation.encoder;
  apply.hidden = copy.hidden;
  copyStatus.textContent = '';
  applyStatus.textContent = '';
  if (!recommendation.encoder) {
    const preview = emptyPreview.cloneNode(true);
    preview.dataset.state = 'error';
    preview.querySelector('p').textContent = recommendation.reason;
    result.append(preview);
    return;
  }
  const preview = document.createElement('div');
  preview.className = 'output-preview';
  preview.append(paragraph(`${recommendation.output[1]}p${recommendation.fps}`, 'output-format'),
    paragraph(`${recommendation.bitrate.toLocaleString()} kbps · ${recommendation.encoder}`, 'output-summary'));
  result.append(preview);
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
  list.append(...settingRows(settings));
  result.append(list,
    paragraph(recommendation.reason + ' The bitrate leaves room for upload fluctuations.', 'note'),
    paragraph('Upload used for this recommendation: ' + recommendation.effectiveUpload.toLocaleString(undefined, { maximumSignificantDigits: 6 }) + ' Mbps.', 'note'),
    paragraph('Enter these values in OBS under Settings → Video and Settings → Output → Streaming (Advanced).', 'note'));
}

async function checkLog(body) {
  return api('/api/stream-test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: session.signal
  });
}

function showTestStatus(text, state = 'info') {
  testStatus.dataset.state = state;
  testStatus.textContent = text;
}

testStart.addEventListener('click', async () => {
  resetStreamCheck();
  const run = streamRun;
  testStart.disabled = true;
  showTestStatus('Preparing to check the OBS log…');
  try {
    const { id, hasLogs } = await checkLog({ action: 'start' });
    if (streamRun !== run) return;
    run.id = id;
    testCheck.hidden = false;
    testStart.textContent = 'Restart log check';
    showTestStatus((hasLogs ? '' : 'No OBS log found yet. ') +
      'Start your test stream in OBS, use your usual scene for at least 30 seconds, then stop the stream and check results.');
  } catch {
    if (streamRun === run) showTestStatus('The OBS log check couldn’t start. You can still ask for fallback settings.', 'error');
  } finally {
    if (streamRun === run) testStart.disabled = false;
  }
});

testCheck.addEventListener('click', async () => {
  const run = streamRun;
  if (!run.id) return;
  testCheck.disabled = true;
  showTestStatus('Checking recent OBS log entries…');
  try {
    const outcome = await checkLog({ action: 'check', id: run.id });
    if (streamRun !== run) return;
    const messages = {
      waiting: 'No completed test stream was found. Start and stop a stream in OBS after starting the log check, then check again.',
      running: 'OBS logged a stream start. Stop the test stream in OBS, then check again.',
      unavailable: 'No OBS log was available. Check OBS → View → Stats or ask for fallback settings.',
      inconclusive: 'OBS didn’t log enough stream statistics to assess this test. You can ask for fallback settings.',
      expired: 'This log check expired. Start a new check to test again.',
      short: 'OBS logged no frame loss during this short test. Try at least 30 seconds with your usual scene.',
      clean: 'OBS logged no network drops, rendering lag, or encoding skips for this test. Review the stream’s audio and playback as well.'
    };
    if (outcome.status === 'issues') {
      showTestStatus('OBS reported ' + outcome.network.toLocaleString() + ' network drops, ' +
        outcome.rendering.toLocaleString() + ' frames affected by rendering lag, and ' +
        outcome.encoding.toLocaleString() + ' encoding skips. Select “Settings still aren’t right” to see a safer profile.', 'error');
    } else {
      showTestStatus(messages[outcome.status] || messages.inconclusive, outcome.status === 'clean' ? 'success' : 'info');
    }
  } catch {
    if (streamRun === run) showTestStatus('The OBS log couldn’t be checked. You can still ask for fallback settings.', 'error');
  } finally {
    if (streamRun === run) testCheck.disabled = false;
  }
});

testFallback.addEventListener('click', () => {
  if (!recommendation.hasFallback) {
    showTestStatus('This is the lowest supported setup for your current inputs.');
    return;
  }
  const before = recommendation;
  recommendationInput = { ...recommendationInput, fallbackStep: recommendationInput.fallbackStep + 1 };
  renderRecommendation();
  showTestStatus('Previous setup: ' + before.output[1] + 'p' + before.fps + ' at ' +
    before.bitrate.toLocaleString() + ' kbps. Apply the fallback in OBS and run another test.');
});

testPrevious.addEventListener('click', () => {
  recommendationInput = { ...recommendationInput, fallbackStep: recommendationInput.fallbackStep - 1 };
  renderRecommendation();
});

copy.addEventListener('click', async () => {
  const copied = recommendation;
  let message;
  try {
    const settings = formatSettings(copied);
    if (desktop) await desktopRequest('/desktop/clipboard', settings);
    else await navigator.clipboard.writeText(settings);
    message = 'Settings copied.';
  } catch {
    message = 'Clipboard unavailable. The settings are listed above.';
  }
  if (recommendation === copied) copyStatus.textContent = message;
});
apply.addEventListener('click', () => {
  profileInput = recommendationInput;
  const { platform, encoder, bitrate } = recommendation;
  const overview = [
    ['Platform', platform === 'youtube' ? 'YouTube' : 'Twitch'],
    ['Video encoder', encoder],
    ['Video bitrate', bitrate.toLocaleString() + ' kbps']
  ];
  const settings = result.querySelector('dl').cloneNode(true);
  profileSummary.replaceChildren(...settingRows(overview), ...settings.children);
  profileStatus.textContent = '';
  delete profileStatus.dataset.state;
  profileDialog.showModal();
});
cancelProfile.addEventListener('click', () => profileDialog.close());
profileDialog.addEventListener('cancel', event => {
  if (saveProfile.disabled) event.preventDefault();
});
saveProfile.addEventListener('click', async () => {
  saveProfile.disabled = cancelProfile.disabled = true;
  delete profileStatus.dataset.state;
  profileStatus.textContent = 'Creating the OBS profile…';
  try {
    const profile = await api('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileInput)
    });
    profileDialog.close();
    if (recommendationInput === profileInput) apply.hidden = true;
    applyStatus.textContent = 'Created “' + profile.name + '”. Reopen OBS if it’s running, select this profile from the Profile menu, then connect your streaming account or enter your stream key in OBS.';
    copy.focus();
  } catch (error) {
    profileStatus.dataset.state = 'error';
    profileStatus.textContent = error.message;
  } finally {
    saveProfile.disabled = cancelProfile.disabled = false;
  }
});
form.elements.canvas.addEventListener('change', () => { canvasTouched = true; });
clear.addEventListener('click', () => {
  session.abort();
  session = new AbortController();
  hardware = {};
  recommendation = undefined;
  recommendationInput = undefined;
  resetStreamCheck();
  streamTest.hidden = true;
  resultTitle.textContent = 'Recommended settings';
  canvasTouched = false;
  form.reset();
  scan.disabled = speed.disabled = false;
  copy.hidden = true;
  apply.hidden = true;
  delete hardwareLabel.dataset.state;
  hardwareLabel.textContent = hardwareHint;
  delete network.dataset.state;
  network.textContent = '';
  result.replaceChildren(emptyPreview.cloneNode(true));
  copyStatus.textContent = 'Session cleared.';
  applyStatus.textContent = '';
});
scan.addEventListener('click', probe);
