import assert from 'node:assert/strict';
import test from 'node:test';
import { recommend, formatSettings } from './advisor.js';
import { parseObsLog } from './hardware.js';

const session = { platform: 'youtube', content: 'gameplay', upload: 43, canvas: 1080,
  available: ['nvencAv1', 'nvencH264'], cores: 20 };

test('uses AV1 on YouTube and standard H.264 on Twitch', () => {
  const youtube = recommend(session);
  assert.equal(youtube.encoder, 'NVIDIA NVENC AV1');
  assert.deepEqual(youtube.output, [1920, 1080]);
  assert.equal(youtube.fps, 60);
  assert.equal(youtube.bitrate, 12000);
  assert.match(formatSettings(youtube), /CBR, 12000 kbps/);
  const twitch = recommend({ ...session, platform: 'twitch' });
  assert.equal(twitch.encoder, 'NVIDIA NVENC H.264');
  assert.equal(twitch.bitrate, 6000);
});

test('constrains frame rate, resolution and bitrate for slower connections and software encoding', () => {
  const weak = recommend({ ...session, upload: 3, platform: 'twitch' });
  assert.deepEqual(weak.output, [854, 480]);
  assert.equal(weak.fps, 30);
  assert.ok(weak.bitrate + weak.audio <= 3000 * 0.7);
  assert.equal(recommend({ ...session, upload: 0.1 }).encoder, undefined);
  const cpu = recommend({ ...session, available: [] });
  assert.equal(cpu.encoder, 'x264');
  assert.deepEqual(cpu.output, [1280, 720]);
  assert.equal(cpu.fps, 30);
  assert.equal(recommend({ ...session, content: 'talk' }).fps, 30);
  assert.throws(() => recommend({ ...session, upload: NaN }));
});

test('budgets from the lower of measured upload and the verified upload ceiling', () => {
  const capped = recommend({ ...session, upload: 89.43, uploadCeiling: 50 });
  assert.equal(capped.effectiveUpload, 50);
  assert.equal(capped.budget, 34800);
  const belowCeiling = recommend({ ...session, upload: 40, uploadCeiling: 50 });
  assert.equal(belowCeiling.effectiveUpload, 40);
});

test('fallbacks progressively lighten the output or bitrate while keeping the canvas and encoder', () => {
  let previous = recommend(session);
  for (let fallbackStep = 1; previous.hasFallback; fallbackStep++) {
    assert.ok(fallbackStep <= 32);
    const next = recommend({ ...session, fallbackStep });
    assert.deepEqual(next.canvas, previous.canvas);
    assert.equal(next.encoderId, previous.encoderId);
    assert.ok(next.output[1] <= previous.output[1] && next.fps <= previous.fps && next.bitrate <= previous.bitrate);
    assert.ok(next.output[1] < previous.output[1] || next.fps < previous.fps || next.bitrate < previous.bitrate);
    previous = next;
  }
  const lower = recommend({ ...session, platform: 'twitch', fallbackStep: 1 });
  assert.deepEqual(lower.output, [1280, 720]);
  assert.equal(lower.bitrate, 4500);
  assert.equal(recommend({ ...session, upload: 0.62 }).hasFallback, false);
  assert.throws(() => recommend({ ...session, fallbackStep: 33 }));
});

test('extracts only hardware and registered encoder details from OBS logs', () => {
  const text = `00:01: OBS 33.0.1 (64-bit, windows)
00:01: CPU Name: Sample CPU
00:01: Physical Cores: 16, Logical Cores: 24
00:01:     Adapter 0: Sample GPU
00:01:     base resolution: 2560x1440
00:01:     - obs_nvenc_av1_tex (NVIDIA NVENC AV1)
00:01:     - obs_nvenc_h264_tex (NVIDIA NVENC H.264)
00:02:     base resolution: 1920x1080
00:03: unrelated settings: h264_amf
00:03: source title: CPU Name: Private note
00:03: source title: Adapter 1: Private note
00:03: unrelated profile value: test-only`;
  assert.deepEqual(parseObsLog(text), {
    obs: '33.0.1', cpu: 'Sample CPU', cores: 16, gpus: ['Sample GPU'],
    canvas: 1080, available: ['nvencAv1', 'nvencH264']
  });
  assert.deepEqual(parseObsLog(text, { includeEncoderIds: true }).encoderIds, {
    nvencAv1: 'obs_nvenc_av1_tex', nvencH264: 'obs_nvenc_h264_tex'
  });
});
