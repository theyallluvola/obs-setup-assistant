import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recommend } from './advisor.js';
import { createObsProfile, ObsProfileError, reviewCurrentObsProfile, updateCurrentObsProfile } from './obs-profile.js';

async function fixture(t) {
  const appData = await fs.mkdtemp(path.join(import.meta.dirname, '.obs-profile-test-'));
  t.after(() => fs.rm(appData, { force: true, recursive: true }));
  const profiles = path.join(appData, 'obs-studio', 'basic', 'profiles');
  await fs.mkdir(profiles, { recursive: true });
  return { appData, profiles };
}

function recommendation(platform, encoderId) {
  return recommend({ platform, available: [encoderId], content: 'gameplay', upload: 50, canvas: 1440, cores: 8 });
}

test('creates a discoverable YouTube profile with its exact resolution, rate and encoder settings', async t => {
  const { appData, profiles } = await fixture(t);
  const result = recommendation('youtube', 'nvencAv1');
  const { name } = await createObsProfile(result, { appData, encoderIds: { nvencAv1: 'obs_nvenc_av1_tex' } });
  const folder = path.join(profiles, name);
  assert.deepEqual((await fs.readdir(folder)).sort(), ['basic.ini', 'service.json', 'streamEncoder.json']);
  const ini = await fs.readFile(path.join(folder, 'basic.ini'), 'utf8');
  for (const [section, settings] of Object.entries({
    General: [`Name=${name}`], Output: ['Mode=Advanced'],
    Video: ['BaseCX=2560', 'BaseCY=1440', 'OutputCX=2560', 'OutputCY=1440', 'FPSType=0', 'FPSCommon=60'],
    AdvOut: ['Encoder=obs_nvenc_av1_tex', 'AudioEncoder=ffmpeg_aac', 'TrackIndex=1', 'Track1Bitrate=128'],
    Audio: ['ChannelSetup=Stereo'], Stream1: ['EnableMultitrackVideo=false']
  })) {
    assert.ok(ini.includes([`[${section}]`, ...settings, ''].join('\n')), section);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'streamEncoder.json'))), {
    rate_control: 'CBR', bitrate: result.bitrate, keyint_sec: 2, preset: 'p5', tune: 'hq', lookahead: false
  });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'service.json'))), {
    type: 'rtmp_common', settings: { service: 'YouTube - RTMPS', server: 'rtmps://a.rtmps.youtube.com:443/live2' }
  });
});

test('parallel requests preserve existing profiles, service data, scenes and current selection', async t => {
  const { appData, profiles } = await fixture(t);
  const original = path.join(profiles, 'Original');
  const scenes = path.join(profiles, '..', 'scenes');
  await fs.mkdir(original);
  await fs.mkdir(scenes);
  const originalFiles = new Map([
    [path.join(original, 'basic.ini'), '[General]\nName=Original'],
    [path.join(original, 'service.json'), '{"settings":{"key":"fixture-only"}}'],
    [path.join(scenes, 'Work.json'), '{"name":"Work"}'],
    [path.join(appData, 'obs-studio', 'user.ini'), '[Basic]\nProfile=Original']
  ]);
  for (const [file, data] of originalFiles) await fs.writeFile(file, data);
  const result = recommendation('twitch', 'x264');
  const options = { appData, encoderIds: { x264: 'obs_x264' } };
  const created = await Promise.all([createObsProfile(result, options), createObsProfile(result, options)]);
  assert.notEqual(created[0].name, created[1].name);
  for (const [file, data] of originalFiles) assert.equal(await fs.readFile(file, 'utf8'), data);
  for (const { name } of created) {
    const folder = path.join(profiles, name);
    const ini = await fs.readFile(path.join(folder, 'basic.ini'), 'utf8');
    assert.match(ini, /OutputCX=1280\nOutputCY=720\nFPSType=0\nFPSCommon=30/);
    assert.match(ini, /Encoder=obs_x264\nAudioEncoder=ffmpeg_aac\nTrackIndex=1\nTrack1Bitrate=160/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'streamEncoder.json'))), {
      rate_control: 'CBR', bitrate: result.bitrate, keyint_sec: 2, preset: 'veryfast'
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'service.json'))), {
      type: 'rtmp_common', settings: { service: 'Twitch', server: 'auto' }
    });
  }
});

test('preserves source encoder IDs and writes the settings used by the corresponding plugin', async t => {
  const { appData, profiles } = await fixture(t);
  for (const [encoderId, id, expectedExtra] of [
    ['qsvH264', 'obs_qsv11_v2', {}], ['qsvAv1', 'obs_qsv11_av1', {}],
    ['amfH264', 'h264_texture_amf', {}], ['amfAv1', 'av1_texture_amf', {}],
    ['nvencH264', 'ffmpeg_nvenc', { preset2: 'p5', tune: 'hq', lookahead: false }]
  ]) {
    const result = recommendation('youtube', encoderId);
    const { name } = await createObsProfile(result, { appData, encoderIds: { [encoderId]: id } });
    const folder = path.join(profiles, name);
    assert.ok((await fs.readFile(path.join(folder, 'basic.ini'), 'utf8')).includes(`Encoder=${id}\n`));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'streamEncoder.json'))), {
      rate_control: 'CBR', bitrate: result.bitrate, keyint_sec: 2, ...expectedExtra
    });
  }
});

test('unavailable encoders, invalid recommendations and an uninitialized OBS install create nothing', async t => {
  const { appData, profiles } = await fixture(t);
  const result = recommendation('twitch', 'nvencH264');
  for (const [data, encoderIds] of [
    [result, {}], [result, { nvencH264: 'bad\n[General]' }],
    [{ ...result, fps: '60\n[Other]' }, { nvencH264: 'obs_nvenc_h264_tex' }],
    [recommendation('twitch', 'amfH264'), { amfH264: 'amd_amf_h264' }],
    [{ reason: 'insufficient upload' }, {}]
  ]) {
    await assert.rejects(createObsProfile(data, { appData, encoderIds }), ObsProfileError);
  }
  assert.deepEqual(await fs.readdir(profiles), []);
  await fs.rmdir(profiles);
  await assert.rejects(createObsProfile(result, { appData, encoderIds: { nvencH264: 'obs_nvenc_h264_tex' } }),
    /Open standard Windows OBS Studio/);
  await assert.rejects(fs.stat(profiles), { code: 'ENOENT' });
});

test('a failed final write never publishes an incomplete profile and can be retried', async t => {
  const { appData, profiles } = await fixture(t);
  const result = recommendation('twitch', 'x264');
  const options = { appData, encoderIds: { x264: 'obs_x264' } };
  const failingRename = t.mock.method(fs, 'rename', async (from, to) => {
    assert.equal(path.dirname(path.dirname(from)), profiles);
    const names = await fs.readdir(path.dirname(to));
    assert.ok(names.includes('streamEncoder.json'));
    assert.ok(!names.includes('basic.ini'));
    throw Object.assign(new Error('simulated failure'), { code: 'ENOSPC' });
  });
  await assert.rejects(createObsProfile(result, options), ObsProfileError);
  assert.equal(failingRename.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(profiles), []);
  failingRename.mock.restore();
  const { name } = await createObsProfile(result, options);
  assert.deepEqual(await fs.readdir(profiles), [name]);
});

async function currentFixture(t, { legacy = false, oldEncoder = true } = {}) {
  const { appData, profiles } = await fixture(t);
  const directory = path.join(profiles, 'Streaming');
  await fs.mkdir(directory);
  const config = path.join(appData, 'obs-studio', legacy ? 'global.ini' : 'user.ini');
  const selection = '[Basic]\nProfile=My Main Profile\nProfileDir=Streaming\n';
  const ini = '\uFEFF[General]\r\nName=My Main Profile\r\n[Output]\r\nMode=Advanced\r\n' +
    '[AdvOut]\r\nEncoder=obs_nvenc_av1_tex\r\nRecFilePath=D:\\Recordings\r\n' +
    'TrackIndex=2\r\nVodTrackEnabled=true\r\nVodTrackIndex=3\r\nRescale=true\r\n';
  const encoder = '{"preset":"p7","bitrate":20000,"multipass":"fullres"}';
  const service = '{"type":"rtmp_common","settings":{"service":"YouTube - RTMPS","key":"fixture-only"}}';
  const files = new Map([['basic.ini', ini], ['service.json', service], ['recordEncoder.json', '{"arbitrary":true}']]);
  if (oldEncoder) files.set('streamEncoder.json', encoder);
  await fs.writeFile(config, selection);
  for (const [file, contents] of files) await fs.writeFile(path.join(directory, file), contents);
  const options = { appData, encoderIds: { nvencAv1: 'obs_nvenc_av1_tex' }, checkClosed: async () => {} };
  return { directory, config, selection, files, options, result: recommendation('youtube', 'nvencAv1') };
}

test('updates the selected OBS profile in place and backs up the two edited files', async t => {
  const { directory, config, selection, files, options, result } = await currentFixture(t, { legacy: true });
  const review = await reviewCurrentObsProfile('youtube', options);
  assert.equal(review.name, 'My Main Profile');
  assert.equal(review.changesOutputMode, false);
  const { name, backup } = await updateCurrentObsProfile(result, review.revision, options);
  assert.equal(name, review.name);
  assert.equal(path.dirname(backup), directory);
  assert.equal(await fs.readFile(config, 'utf8'), selection);
  for (const [file, content] of files) {
    const stored = ['basic.ini', 'streamEncoder.json'].includes(file) ? backup : directory;
    assert.equal(await fs.readFile(path.join(stored, file), 'utf8'), content);
  }
  assert.deepEqual((await fs.readdir(backup)).sort(), ['basic.ini', 'streamEncoder.json']);
  const ini = await fs.readFile(path.join(directory, 'basic.ini'), 'utf8');
  for (const line of ['Mode=Advanced', 'Rescale=false', 'TrackIndex=2', 'Track2Bitrate=128', 'Track3Bitrate=128',
    'RecFilePath=D:\\Recordings', 'OutputCX=2560', 'FPSCommon=60', 'ChannelSetup=Stereo']) {
    assert.ok(ini.includes(line + '\r\n'), line);
  }
  assert.ok(ini.startsWith('\uFEFF'));
  const stream = JSON.parse(await fs.readFile(path.join(directory, 'streamEncoder.json'), 'utf8'));
  assert.equal(stream.bitrate, result.bitrate);
  assert.equal(stream.preset, 'p5');
  assert.equal(stream.multipass, 'fullres');
});

test('rejects an open OBS instance, a mismatched service, and a stale or unsafe profile selection', async t => {
  const { config, selection, directory, options, result } = await currentFixture(t);
  const checkClosed = async () => { throw new ObsProfileError('Close OBS'); };
  await assert.rejects(reviewCurrentObsProfile('youtube', { ...options, checkClosed }), /Close OBS/);
  await assert.rejects(reviewCurrentObsProfile('twitch', options), /streaming service to Twitch/);
  const { revision } = await reviewCurrentObsProfile('youtube', options);
  await fs.appendFile(path.join(directory, 'basic.ini'), 'Track2Bitrate=320\r\n');
  await assert.rejects(updateCurrentObsProfile(result, revision, options), /profile changed/);
  await fs.writeFile(config, selection.replace('ProfileDir=Streaming', 'ProfileDir=../Streaming'));
  await assert.rejects(reviewCurrentObsProfile('youtube', options), /Select a profile/);
  assert.equal((await fs.readdir(directory)).length, 4);
});

test('restores the encoder file after a failed profile write or removes it if originally absent', async t => {
  for (const oldEncoder of [true, false]) {
    const { directory, files, options, result } = await currentFixture(t, { oldEncoder });
    const { revision } = await reviewCurrentObsProfile('youtube', options);
    const rename = fs.rename;
    const fail = t.mock.method(fs, 'rename', async (from, to) => {
      if (path.basename(to) === 'basic.ini') throw Object.assign(new Error('simulated failure'), { code: 'ENOSPC' });
      await rename(from, to);
    });
    await assert.rejects(updateCurrentObsProfile(result, revision, options), /could not update/);
    fail.mock.restore();
    for (const [file, contents] of files) assert.equal(await fs.readFile(path.join(directory, file), 'utf8'), contents);
    if (!oldEncoder) await assert.rejects(fs.stat(path.join(directory, 'streamEncoder.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(directory, '.obs-setup-update.lock')), { code: 'ENOENT' });
  }
});
