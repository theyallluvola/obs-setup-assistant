import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStreamTests, readStreamResult } from './stream-test.js';

const clean = [
  '23:59:45.010: ==== Streaming Start ========================================',
  "00:00:20.000: Output 'adv_stream': Total frames output: 2100",
  "00:00:20.005: Output 'adv_stream': Total drawn frames: 2100",
  '00:00:20.009: ==== Streaming Stop =========================================',
  ''
].join('\n');

test('checks a completed OBS stream and recognizes omitted zero counters across midnight', () => {
  assert.deepEqual(readStreamResult(clean), {
    status: 'clean', duration: 35, frames: 2100, network: 0, rendering: 0, encoding: 0
  });
  assert.equal(readStreamResult(clean.replace('23:59:45', '23:59:58')).status, 'short');
  assert.equal(readStreamResult(clean.replace("Output 'adv_stream': Total drawn frames", 'unrelated')).status, 'inconclusive');
  assert.equal(readStreamResult(clean.replace('Streaming Stop', 'Recording Stop')).status, 'running');
});

test('reports frame loss from OBS streaming output summaries and ignores recording counters', () => {
  const issue = clean.replace('00:00:20.009:', [
    "00:00:20.006: Output 'simple_file_output': Number of lagged frames due to rendering lag/stalls: 500",
    "00:00:20.007: Output 'adv_stream': Number of dropped frames due to insufficient bandwidth/connection stalls: 17 (0.8%)",
    "00:00:20.007: Output 'adv_stream': Number of lagged frames due to rendering lag/stalls: 5 (0.2%)",
    '00:00:20.008: Video stopped, number of skipped frames due to encoding lag: 3/2100 (0.1%)',
    '00:00:20.009:'
  ].join('\n'));
  assert.deepEqual(readStreamResult(issue), {
    status: 'issues', duration: 35, frames: 2100, network: 17, rendering: 5, encoding: 3
  });
});

test('reads only newly logged tests and handles missing logs and expiry', async () => {
  const appData = await mkdtemp(path.join(tmpdir(), 'obs-log-check-'));
  const logs = path.join(appData, 'obs-studio', 'logs');
  let time = Date.now();
  const checks = createStreamTests({ appData, now: () => time });
  const noLog = await checks.start();
  assert.equal(noLog.hasLogs, false);
  assert.deepEqual(await checks.check(noLog.id), { status: 'unavailable' });
  await mkdir(logs, { recursive: true });
  const entry = path.join(logs, '2026-11-19 23-50-00.txt');
  await writeFile(entry, clean);
  const check = await checks.start();
  assert.equal(check.hasLogs, true);
  assert.deepEqual(await checks.check(check.id), { status: 'waiting' });
  await appendFile(entry, clean);
  assert.equal((await checks.check(check.id)).status, 'clean');
  time += 31 * 60_000;
  assert.equal((await checks.check(check.id)).status, 'expired');
});
