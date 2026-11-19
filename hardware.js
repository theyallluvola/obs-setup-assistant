import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const run = promisify(execFile);
const patterns = {
  nvencAv1: /obs_nvenc_av1(?:_tex)?\b/i,
  nvencH264: /(?:obs_nvenc_h264(?:_tex)?|ffmpeg_nvenc|jim_nvenc)\b/i,
  qsvAv1: /obs_qsv(?:11)?_av1\b/i,
  qsvH264: /obs_qsv11(?:_v2)?\b/i,
  amfAv1: /(?:av1_texture_amf|av1_amf)\b/i,
  amfH264: /(?:h264_texture_amf|h264_amf|amd_amf_h264)\b/i
};

function summarizeLog() {
  const summary = { obs: '', cpu: '', cores: 0, gpus: [], canvas: 0, available: [] };
  const gpus = new Set();
  const encoderIds = new Map();

  return {
    add(line) {
      const entry = line.replace(/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?:\s*/, '').trim();
      const version = /^OBS (\d+\.\d+\.\d+)/.exec(entry);
      const cpu = /^CPU Name:\s*(.{1,160})$/i.exec(entry);
      const cores = /^Physical Cores:\s*(\d+)/i.exec(entry);
      const gpu = /^Adapter \d+:\s*(.{1,160})$/i.exec(entry);
      const canvas = /^base resolution:\s*\d+x(\d+)$/i.exec(entry);
      if (version) summary.obs ||= version[1];
      if (cpu) summary.cpu ||= cpu[1];
      if (cores) summary.cores ||= Number(cores[1]);
      if (gpu) gpus.add(gpu[1]);
      if (canvas) summary.canvas = Number(canvas[1]);
      const encoder = /^- ([\w]+)\s+\(/.exec(entry)?.[1];
      if (encoder) {
        if (encoder === 'obs_x264') encoderIds.set('x264', encoder);
        for (const [id, pattern] of Object.entries(patterns)) {
          if (pattern.exec(encoder)?.[0] === encoder && !encoderIds.has(id)) encoderIds.set(id, encoder);
        }
      }
    },
    result() {
      return {
        ...summary, gpus: [...gpus],
        available: [...encoderIds.keys()].filter(id => id !== 'x264'),
        encoderIds: Object.fromEntries(encoderIds)
      };
    }
  };
}

export function parseObsLog(text, { includeEncoderIds = false } = {}) {
  const parsed = summarizeLog();
  for (const line of text.split(/\r?\n/)) parsed.add(line);
  const { encoderIds, ...hardware } = parsed.result();
  return includeEncoderIds ? { ...hardware, encoderIds } : hardware;
}

async function obsHardware() {
  if (!process.env.APPDATA) return {};
  const directory = path.join(process.env.APPDATA, 'obs-studio', 'logs');
  try {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^\d{4}-.*\.txt$/i.test(entry.name))
      .map(entry => entry.name).sort().reverse();
    for (const filename of files.slice(0, 3)) {
      const parsed = summarizeLog();
      const input = createReadStream(path.join(directory, filename), { encoding: 'utf8', end: 8 * 1024 ** 2 - 1 });
      for await (const line of createInterface({ input, crlfDelay: Infinity })) parsed.add(line);
      const data = parsed.result();
      if (data.obs) return data;
    }
  } catch {
    // Portable and newly installed copies may not have a log yet.
  }
  return {};
}

export async function detectHardware() {
  const obs = await obsHardware();
  let windows = {};
  if (process.platform === 'win32' && (!obs.gpus?.length || !obs.cores)) {
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $cpu=@(Get-CimInstance Win32_Processor); ' +
        '@{cpu=$cpu[0].Name;cores=($cpu | Measure-Object NumberOfCores -Sum).Sum;gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object Name)} | ConvertTo-Json -Compress'],
        { timeout: 4500, windowsHide: true });
      windows = JSON.parse(stdout);
    } catch {
      // The manual encoder selector is available when Windows blocks detection.
    }
  }
  return {
    cpu: obs.cpu || windows.cpu || os.cpus()[0]?.model || 'Unavailable',
    cores: obs.cores || windows.cores || 0,
    ram: Math.round(os.totalmem() / 2 ** 30),
    gpus: obs.gpus?.length ? obs.gpus : windows.gpus || [],
    obs: obs.obs || '',
    canvas: obs.canvas || 0,
    available: obs.available || [],
    encoderIds: obs.encoderIds || {}
  };
}
