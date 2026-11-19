import { randomUUID } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const maxRead = 1024 ** 2;
const maxTests = 12;
const testLifetime = 30 * 60_000;
const oneDay = 24 * 60 * 60;

function seconds(match) {
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function readStreamResult(text) {
  let run;
  const lines = text.split('\n');
  lines.pop();
  for (const line of lines) {
    const entry = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?:\s*(.*)$/.exec(line.trimEnd());
    if (!entry) continue;
    const message = entry[4];
    if (/^=+ Streaming Start =+$/.test(message)) {
      run = { start: seconds(entry), frames: 0, drawn: 0, network: 0, rendering: 0, encoding: 0 };
      continue;
    }
    if (!run || run.duration !== undefined) continue;
    if (/^=+ Streaming Stop =+$/.test(message)) {
      run.duration = (seconds(entry) - run.start + oneDay) % oneDay;
      continue;
    }
    const skipped = /^Video stopped, number of skipped frames due to encoding lag: (\d+)\/\d+/.exec(message);
    if (skipped) run.encoding += Number(skipped[1]);
    const output = /^Output '(?:adv_stream|simple_stream)': (.*)$/.exec(message)?.[1];
    if (!output) continue;
    for (const [key, prefix] of [
      ['frames', 'Total frames output: '],
      ['drawn', 'Total drawn frames: '],
      ['network', 'Number of dropped frames due to insufficient bandwidth/connection stalls: '],
      ['rendering', 'Number of lagged frames due to rendering lag/stalls: ']
    ]) {
      if (output.startsWith(prefix)) run[key] = Number(/^\d+/.exec(output.slice(prefix.length))?.[0] || 0);
    }
  }
  if (!run) return null;
  if (run.duration === undefined) return { status: 'running' };
  if (!run.frames || !run.drawn) return { status: 'inconclusive' };
  const { duration, frames, network, rendering, encoding } = run;
  const status = network || rendering || encoding ? 'issues' : duration < 30 ? 'short' : 'clean';
  return { status, duration, frames, network, rendering, encoding };
}

export function createStreamTests({ appData = process.env.APPDATA, now = Date.now } = {}) {
  const directory = appData && path.isAbsolute(appData) ? path.join(appData, 'obs-studio', 'logs') : null;
  const tests = new Map();

  async function logs() {
    if (!directory) return [];
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const names = entries.filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2} [\d-]+\.txt$/i.test(entry.name))
        .map(entry => entry.name).sort().reverse().slice(0, 8);
      return (await Promise.all(names.map(async name => {
        const filename = path.join(directory, name);
        const info = await stat(filename).catch(() => null);
        return info?.isFile() ? { name, filename, size: info.size, born: info.birthtimeMs } : null;
      }))).filter(Boolean);
    } catch { return []; }
  }

  return {
    async start() {
      const since = now();
      const files = await logs();
      for (const [id, test] of tests) if (since - test.since > testLifetime) tests.delete(id);
      if (tests.size >= maxTests) tests.delete(tests.keys().next().value);
      const id = randomUUID();
      tests.set(id, { since, offsets: new Map(files.map(file => [file.name, file])) });
      return { id, hasLogs: files.length > 0 };
    },
    async check(id, signal) {
      const test = tests.get(id);
      if (!test || now() - test.since > testLifetime) return { status: 'expired' };
      const files = await logs();
      for (const file of files) {
        signal?.throwIfAborted();
        const previous = test.offsets.get(file.name);
        const sameFile = previous?.born === file.born;
        if (!sameFile && file.born < test.since) continue;
        const offset = sameFile ? previous.size : 0;
        const length = file.size - offset;
        if (length > maxRead) return { status: 'inconclusive' };
        if (length <= 0) continue;
        try {
          const log = await open(file.filename, 'r');
          try {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await log.read(buffer, 0, length, offset);
            const result = readStreamResult(buffer.toString('utf8', 0, bytesRead));
            if (result) return result;
          } finally { await log.close(); }
        } catch { /* OBS may rotate or lock a log while it is being checked. */ }
      }
      return { status: files.length ? 'waiting' : 'unavailable' };
    }
  };
}
