export const encoders = {
  nvencAv1: 'NVIDIA NVENC AV1',
  nvencH264: 'NVIDIA NVENC H.264',
  qsvAv1: 'Intel Quick Sync AV1',
  qsvH264: 'Intel Quick Sync H.264',
  amfAv1: 'AMD HW AV1',
  amfH264: 'AMD HW H.264',
  x264: 'x264'
};

// Each row is output height, FPS, preferred video kbps, minimum video kbps.
const twitch = [[1080, 60, 6000, 6000], [1080, 30, 4500, 4500], [720, 60, 4500, 4500],
  [720, 30, 3000, 3000], [480, 30, 1500, 1200]];
const youtubeH264 = [[1440, 60, 34000, 8000], [1440, 30, 21000, 7000],
  [1080, 60, 17000, 6000], [1080, 30, 14000, 5000],
  [720, 60, 8000, 3000], [720, 30, 8000, 3000], [480, 30, 4000, 400]];
const youtubeAv1 = [[1440, 60, 24000, 6000], [1440, 30, 15000, 5000],
  [1080, 60, 12000, 4000], [1080, 30, 10000, 4000],
  [720, 60, 6000, 2000], [720, 30, 6000, 2000], [480, 30, 3000, 300]];
const widthFor = { 1440: 2560, 1080: 1920, 720: 1280, 480: 854 };

export function recommend({ platform, content, upload, uploadCeiling, canvas, available, cores = 0 }) {
  if (!['youtube', 'twitch'].includes(platform) || !['gameplay', 'talk'].includes(content) ||
      !Number.isFinite(upload) || upload <= 0 || ![480, 720, 1080, 1440].includes(canvas) ||
      !Array.isArray(available) ||
      (uploadCeiling !== undefined && (!Number.isFinite(uploadCeiling) || uploadCeiling <= 0))) {
    throw new Error('Choose your platform and canvas, then enter a positive upload speed.');
  }
  const h264 = ['nvencH264', 'qsvH264', 'amfH264'];
  const candidates = platform === 'youtube' ? ['nvencAv1', 'qsvAv1', 'amfAv1', ...h264] : h264;
  const encoder = candidates.find(id => available.includes(id)) || 'x264';
  const av1 = encoder.endsWith('Av1');
  const hardware = encoder !== 'x264';
  const wantsMotion = content === 'gameplay';
  const audio = platform === 'youtube' ? 128 : 160;
  const effectiveUpload = Math.min(upload, uploadCeiling ?? upload);
  const budget = Math.max(0, Math.floor((effectiveUpload * 700 - audio) / 100) * 100);
  const tiers = platform === 'twitch' ? twitch : av1 ? youtubeAv1 : youtubeH264;
  const maxHeight = hardware ? canvas : Math.min(canvas, wantsMotion || cores < 6 ? 720 : 1080);
  const eligible = tiers.filter(([height, fps]) => height <= maxHeight && (fps === 30 || (hardware && wantsMotion)));
  const priority = [...eligible].sort(([aHeight, aFps], [bHeight, bFps]) =>
    (wantsMotion ? bFps - aFps : 0) || bHeight - aHeight);

  // YouTube publishes bitrate floors and targets. Hold back on resolution if
  // the available video bitrate is much closer to the floor than the target.
  const ideal = priority.find(([, , preferred, minimum]) =>
    Math.max(minimum, preferred * (platform === 'youtube' ? 2 / 3 : 1)) <= budget);
  const fallback = [...eligible].sort(([aHeight, aFps], [bHeight, bFps]) => aHeight - bHeight || aFps - bFps)
    .find(([, , , minimum]) => minimum <= budget);
  const selected = ideal || fallback;
  if (!selected) return { budget, audio, effectiveUpload, reason: 'This upload speed leaves too little headroom for the profiles this app supports.' };
  const [height, fps, preferred] = selected;
  return {
    platform, encoder: encoders[encoder], canvas: [widthFor[canvas], canvas],
    output: [widthFor[height], height], fps, bitrate: Math.min(preferred, budget),
    budget, audio, effectiveUpload, keyframes: 2, rateControl: 'CBR',
    preset: encoder.startsWith('nvenc') ? 'P5 · High Quality · Look-ahead off' : hardware ? 'Encoder default' : 'veryfast',
    reason: hardware ? 'A hardware encoder leaves more CPU time for the game and OBS.' :
      'Software encoding uses the CPU. The app chose a lighter output to leave headroom.',
    constrained: !ideal || height === 480
  };
}

export function formatSettings(result) {
  return [
    `OBS Studio · ${result.platform === 'youtube' ? 'YouTube' : 'Twitch'}`,
    `Settings → Video: ${result.canvas.join('×')} canvas, ${result.output.join('×')} output, ${result.fps} FPS`,
    `Settings → Output → Streaming (Advanced): ${result.encoder}, ${result.rateControl}, ${result.bitrate} kbps`,
    `Keyframe interval: ${result.keyframes} seconds. Preset: ${result.preset}`,
    `Audio: AAC stereo, ${result.audio} kbps`
  ].join('\n');
}
