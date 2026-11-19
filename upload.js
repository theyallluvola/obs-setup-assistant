import { randomBytes } from 'node:crypto';

const endpoint = 'https://speed.cloudflare.com/__up';
const mib = 1024 ** 2;
const maxChunk = 12 * mib;
const dataLimit = 256 * mib;
const warmupMs = 8000;
const windowMs = 6000;

export class UploadLimitError extends Error {
  constructor() {
    super('The test reached its data limit before it could measure sustained upload. Enter a steady upload result manually.');
  }
}

export async function sampleSustainedUpload(send, now = () => performance.now()) {
  let total = 0;
  let nextChunk = 256 * 1024;

  async function sampleWindow(duration) {
    const start = now();
    let windowBytes = 0;
    while (now() - start < duration) {
      const bytes = Math.min(nextChunk, dataLimit - total);
      if (bytes <= 0) throw new UploadLimitError();
      const sentAt = now();
      await send(bytes);
      const elapsed = Math.max(1, now() - sentAt);
      total += bytes;
      windowBytes += bytes;
      // Aim for about one second per request with smaller payloads on slow links.
      nextChunk = Math.max(64 * 1024, Math.min(maxChunk, Math.round(bytes * 1000 / elapsed)));
    }
    return windowBytes * 8 / (now() - start) / 1000;
  }

  await sampleWindow(warmupMs);
  const first = await sampleWindow(windowMs);
  const second = await sampleWindow(windowMs);
  return { upload: Math.floor(Math.min(first, second) * 10) / 10 };
}

export async function measureUpload(signal) {
  const buffer = randomBytes(maxChunk);
  const deadline = AbortSignal.timeout(35000);
  return sampleSustainedUpload(async bytes => {
    const response = await fetch(endpoint, {
      method: 'POST', body: buffer.subarray(0, bytes),
      signal: AbortSignal.any([signal, deadline, AbortSignal.timeout(12000)])
    });
    if (!response.ok) throw new Error('Upload endpoint unavailable.');
    await response.arrayBuffer();
  });
}

