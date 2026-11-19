import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

export function parseObsLog(text) {
  const output = [...text.matchAll(/base resolution:\s+(\d+)x(\d+)/gi)].at(-1);
  const available = Object.keys(patterns).filter(id =>
    text.split(/\r?\n/).some(line => /\s-\s/.test(line) && patterns[id].test(line)));
  return {
    obs: text.match(/\bOBS (\d+\.\d+\.\d+)/)?.[1] || '',
    cpu: text.match(/CPU Name:\s*([^\r\n]+)/i)?.[1]?.trim() || '',
    cores: Number(text.match(/Physical Cores:\s*(\d+)/i)?.[1] || 0),
    gpus: [...new Set([...text.matchAll(/Adapter \d+:\s*([^\r\n]+)/gi)].map(match => match[1].trim()))],
    canvas: output ? Number(output[2]) : 0,
    available
  };
}

async function obsHardware() {
  if (!process.env.APPDATA) return {};
  const directory = path.join(process.env.APPDATA, 'obs-studio', 'logs');
  try {
    const files = (await readdir(directory)).filter(name => /^\d{4}-.*\.txt$/i.test(name)).sort().reverse();
    for (const filename of files.slice(0, 3)) {
      const data = parseObsLog(await readFile(path.join(directory, filename), 'utf8'));
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
    available: obs.available || []
  };
}
