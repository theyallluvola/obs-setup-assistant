import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { encoders } from './advisor.js';

export class ObsProfileError extends Error {}

const services = {
  youtube: { service: 'YouTube - RTMPS', server: 'rtmps://a.rtmps.youtube.com:443/live2' },
  twitch: { service: 'Twitch', server: 'auto' }
};

function validSize(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every(part => Number.isSafeInteger(part) && part > 0 && part <= 16384);
}

function profileSettings(result, encoderIds) {
  if (!result || !Object.hasOwn(services, result.platform) ||
      !Object.hasOwn(encoders, result.encoderId) || !validSize(result.canvas) || !validSize(result.output) ||
      ![30, 60].includes(result.fps) || !Number.isSafeInteger(result.bitrate) || result.bitrate <= 0 ||
      ![128, 160].includes(result.audio) || result.rateControl !== 'CBR' || result.keyframes !== 2) {
    throw new ObsProfileError('Get a complete recommendation before creating an OBS profile.');
  }

  const id = encoderIds?.[result.encoderId];
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    throw new ObsProfileError('Open OBS once, then scan this PC to confirm the recommended encoder before creating a profile.');
  }
  if (id === 'amd_amf_h264') {
    throw new ObsProfileError('This older AMD encoder uses different settings. Copy the recommendation and enter it in OBS.');
  }

  const stream = { rate_control: result.rateControl, bitrate: result.bitrate, keyint_sec: result.keyframes };
  if (result.encoderId === 'x264') stream.preset = 'veryfast';
  if (result.encoderId.startsWith('nvenc')) {
    const presetKey = id.startsWith('obs_nvenc_') ? 'preset' : 'preset2';
    stream[presetKey] = 'p5';
    stream.tune = 'hq';
    stream.lookahead = false;
  }

  const ini = [
    '[Output]', 'Mode=Advanced', '',
    '[Video]', `BaseCX=${result.canvas[0]}`, `BaseCY=${result.canvas[1]}`,
    `OutputCX=${result.output[0]}`, `OutputCY=${result.output[1]}`, 'FPSType=0', `FPSCommon=${result.fps}`, '',
    '[AdvOut]', `Encoder=${id}`, 'AudioEncoder=ffmpeg_aac', 'TrackIndex=1', `Track1Bitrate=${result.audio}`, '',
    '[Audio]', 'ChannelSetup=Stereo', '', '[Stream1]', 'EnableMultitrackVideo=false', ''
  ].join('\n');
  return { ini, stream, service: { type: 'rtmp_common', settings: services[result.platform] } };
}

export async function createObsProfile(recommendation, { appData = process.env.APPDATA, encoderIds } = {}) {
  const { ini, stream, service } = profileSettings(recommendation, encoderIds);
  if (!appData || !path.isAbsolute(appData)) {
    throw new ObsProfileError('The standard Windows OBS profiles folder is unavailable.');
  }

  const profiles = path.join(appData, 'obs-studio', 'basic', 'profiles');
  const platform = recommendation.platform === 'youtube' ? 'YouTube' : 'Twitch';
  const prefix = `OBS Setup - ${platform} ${recommendation.output[1]}p${recommendation.fps} - `;
  let directory;
  try {
    // mkdtemp reserves a fresh directory even when two requests run concurrently.
    directory = await fs.mkdtemp(path.join(profiles, prefix));
    const name = path.basename(directory);
    const write = (filename, data) => fs.writeFile(path.join(directory, filename), data, { flag: 'wx' });
    await write('streamEncoder.json', JSON.stringify(stream, null, 2));
    await write('service.json', JSON.stringify(service, null, 2));
    await write('basic.ini.tmp', `[General]\nName=${name}\n\n${ini}`);
    // OBS discovers profiles by basic.ini. Publish it only after every setting is on disk.
    await fs.rename(path.join(directory, 'basic.ini.tmp'), path.join(directory, 'basic.ini'));
    return { name };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    if (!directory && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
      throw new ObsProfileError('Open standard Windows OBS Studio once to initialize its profiles folder, then try again.');
    }
    throw new ObsProfileError('OBS Setup could not save the new profile. Check write access and free space in the OBS profiles folder.', { cause: error });
  }
}

const run = promisify(execFile);
const activeProfileError = 'Select a profile in standard Windows OBS Studio, close OBS, then try again.';
const changedProfileError = 'The current OBS profile changed. Close this review and open it again.';

async function requireClosedObs() {
  if (process.platform !== 'win32') throw new ObsProfileError('Updating the current OBS profile is available on Windows.');
  let stdout;
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe');
    ({ stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference="Stop"; [bool]([Diagnostics.Process]::GetProcessesByName("obs64").Length -or ' +
      '[Diagnostics.Process]::GetProcessesByName("obs32").Length -or [Diagnostics.Process]::GetProcessesByName("obs").Length)'],
    { timeout: 5000, windowsHide: true }));
  } catch {
    throw new ObsProfileError('Assistant could not check whether OBS is closed. Try again.');
  }
  if (stdout.trim() === 'True') {
    throw new ObsProfileError('Close OBS Studio completely before applying settings to its current profile.');
  }
  if (stdout.trim() !== 'False') throw new ObsProfileError('Assistant could not check whether OBS is closed. Try again.');
}

function iniValues(text) {
  const sections = new Map();
  let section;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    const setting = /^\s*([^#;=]+?)\s*=(.*)$/.exec(line);
    if (heading) {
      const name = heading[1].toLowerCase();
      if (!sections.has(name)) sections.set(name, new Map());
      section = sections.get(name);
    } else if (setting && section) {
      section.set(setting[1].toLowerCase(), setting[2].trim());
    }
  }
  return sections;
}

function mergeIni(original, proposed) {
  const updates = iniValues(proposed);
  const remaining = iniValues(proposed);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  let section = '';
  const lines = original.slice(bom.length).split(/\r?\n/);
  const merged = [];
  const names = new Map(proposed.split('\n').map(line => [line.split('=')[0].toLowerCase(), line.split('=')[0]]));
  function addMissing() {
    for (const [key, value] of remaining.get(section) ?? []) {
      merged.push(`${names.get(key)}=${value}`);
    }
    remaining.delete(section);
  }
  for (const line of lines) {
    const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (heading) {
      addMissing();
      section = heading[1].toLowerCase();
    }
    const setting = /^(\s*[^#;=]+?\s*=)/.exec(line);
    const key = setting?.[1].slice(0, -1).trim().toLowerCase();
    if (updates.get(section)?.has(key)) {
      merged.push(setting[1] + updates.get(section).get(key));
      remaining.get(section)?.delete(key);
    } else {
      merged.push(line);
    }
  }
  addMissing();
  for (const [sectionName, settings] of remaining) {
    merged.push('', names.get(`[${sectionName}]`));
    for (const [key, value] of settings) merged.push(`${names.get(key)}=${value}`);
  }
  return bom + merged.join(eol).replace(/(?:\r?\n)*$/, '') + eol;
}

async function readProfileFile(file, optional = false) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 4 * 1024 ** 2) throw new ObsProfileError(activeProfileError);
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function currentProfile(appData, platform) {
  if (!appData || !path.isAbsolute(appData)) throw new ObsProfileError(activeProfileError);
  try {
    const obs = path.join(appData, 'obs-studio');
    const user = await readProfileFile(path.join(obs, 'user.ini'), true);
    const basic = iniValues(user ?? await readProfileFile(path.join(obs, 'global.ini'))).get('basic');
    const folder = basic?.get('profiledir');
    if (!folder || /[<>:"/\\|?*\u0000-\u001f]|[. ]$/.test(folder)) throw new ObsProfileError(activeProfileError);
    const root = await fs.realpath(path.join(obs, 'basic', 'profiles'));
    const directory = path.join(root, folder);
    if (!(await fs.lstat(directory)).isDirectory()) throw new ObsProfileError(activeProfileError);
    const ini = await readProfileFile(path.join(directory, 'basic.ini'));
    const name = iniValues(ini).get('general')?.get('name') ?? basic.get('profile');
    if (!name) throw new ObsProfileError(activeProfileError);
    const encoder = await readProfileFile(path.join(directory, 'streamEncoder.json'), true);
    const serviceFile = await readProfileFile(path.join(directory, 'service.json'), true);
    const service = JSON.parse(serviceFile ?? 'null');
    const configured = service?.type === 'rtmp_common' && service.settings?.service;
    const matches = platform === 'youtube' ? /^YouTube(?:\s*-\s*RTMPS?)?$/i.test(configured) :
      /^Twitch$/i.test(configured);
    if (!matches) {
      const label = platform === 'youtube' ? 'YouTube' : 'Twitch';
      throw new ObsProfileError(`Set this profile’s streaming service to ${label} in OBS, then close OBS and try again.`);
    }
    const revision = createHash('sha256').update(JSON.stringify([directory, name, ini, encoder, serviceFile])).digest('hex');
    return { directory, name, ini, encoder, revision };
  } catch (error) {
    if (error instanceof ObsProfileError) throw error;
    throw new ObsProfileError(activeProfileError, { cause: error });
  }
}

export async function reviewCurrentObsProfile(platform, { appData = process.env.APPDATA, checkClosed = requireClosedObs } = {}) {
  await checkClosed();
  const { name, revision, ini } = await currentProfile(appData, platform);
  return { name, revision, changesOutputMode: iniValues(ini).get('output')?.get('mode')?.toLowerCase() !== 'advanced' };
}

export async function updateCurrentObsProfile(recommendation, revision, {
  appData = process.env.APPDATA, encoderIds, checkClosed = requireClosedObs
} = {}) {
  const settings = profileSettings(recommendation, encoderIds);
  await checkClosed();
  const profile = await currentProfile(appData, recommendation.platform);
  if (revision !== profile.revision) throw new ObsProfileError(changedProfileError);
  const lockPath = path.join(profile.directory, '.obs-setup-update.lock');
  let lock;
  let backup;
  let encoderWritten = false;
  const iniPath = path.join(profile.directory, 'basic.ini');
  const encoderPath = path.join(profile.directory, 'streamEncoder.json');
  try {
    lock = await fs.open(lockPath, 'wx');
    backup = await fs.mkdtemp(path.join(profile.directory, 'obs-setup-backup-'));
    const write = (filename, content) => fs.writeFile(path.join(backup, filename), content, { flag: 'wx' });
    const before = iniValues(profile.ini);
    const proposed = iniValues(settings.ini);
    // Keep the existing track routing, and apply the bitrate to the selected stream tracks.
    const advanced = before.get('output')?.get('mode')?.toLowerCase() === 'advanced';
    const selected = advanced ? Number(before.get('advout')?.get('trackindex')) : 1;
    const track = Number.isInteger(selected) && selected >= 1 && selected <= 6 ? selected : 1;
    const vod = advanced && before.get('advout')?.get('vodtrackenabled') === 'true'
      ? Number(before.get('advout').get('vodtrackindex')) : 0;
    const updates = settings.ini
      .replace('TrackIndex=1', `Rescale=false\nTrackIndex=${track}`)
      .replace(/^Track1Bitrate=.*$/m, [...new Set([track, vod])].filter(n => n >= 1 && n <= 6 && Number.isInteger(n))
        .map(n => `Track${n}Bitrate=${recommendation.audio}`).join('\n'));
    let stream = {};
    if (profile.encoder !== null && before.get('advout')?.get('encoder') === proposed.get('advout').get('encoder')) {
      try {
        const existing = JSON.parse(profile.encoder);
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) stream = existing;
      } catch {
        // A fresh encoder file replaces malformed encoder settings. The original is backed up.
      }
    }
    await write('basic.ini', profile.ini);
    if (profile.encoder !== null) await write('streamEncoder.json', profile.encoder);
    await write('basic.ini.new', mergeIni(profile.ini, updates));
    await write('streamEncoder.json.new', JSON.stringify({ ...stream, ...settings.stream }, null, 2));
    await checkClosed();
    if ((await currentProfile(appData, recommendation.platform)).revision !== revision) {
      throw new ObsProfileError(changedProfileError);
    }
    await fs.rename(path.join(backup, 'streamEncoder.json.new'), encoderPath);
    encoderWritten = true;
    await fs.rename(path.join(backup, 'basic.ini.new'), iniPath);
    return { name: profile.name, backup };
  } catch (error) {
    if (encoderWritten) {
      try {
        if (profile.encoder === null) await fs.unlink(encoderPath);
        else {
          const restore = path.join(backup, 'streamEncoder.json.restore');
          await fs.copyFile(path.join(backup, 'streamEncoder.json'), restore);
          await fs.rename(restore, encoderPath);
        }
      } catch {
        throw new ObsProfileError(`Assistant could not finish restoring the profile. Keep OBS closed and restore the original files from ${backup}.`);
      }
    }
    if (!lock && error.code === 'EEXIST') {
      throw new ObsProfileError('Another profile update is in progress or was interrupted. Check the profile’s backup folder before retrying.');
    }
    if (error instanceof ObsProfileError) throw error;
    throw new ObsProfileError('Assistant could not update the current OBS profile. Check write access and free space.', { cause: error });
  } finally {
    if (backup) {
      for (const file of ['basic.ini.new', 'streamEncoder.json.new', 'streamEncoder.json.restore']) {
        await fs.unlink(path.join(backup, file)).catch(() => {});
      }
    }
    if (lock) {
      await lock.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}
