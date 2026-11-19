import fs from 'node:fs/promises';
import path from 'node:path';
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
