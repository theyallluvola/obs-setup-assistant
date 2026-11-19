import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleSustainedUpload, UploadLimitError } from './upload.js';

test('ignores a 110 Mbps opening burst that settles to 50 Mbps', async () => {
  let time = 0;
  let bytesSent = 0;
  const result = await sampleSustainedUpload(async bytes => {
    const burstBytes = Math.min(bytes, Math.max(0, 6000 - time) * 110000 / 8);
    time += burstBytes * 8 / 110000 + (bytes - burstBytes) * 8 / 50000;
    bytesSent += bytes;
  }, () => time);
  assert.ok(result.upload >= 49.9 && result.upload <= 50);
  assert.ok(time >= 20000);
  assert.ok(bytesSent <= 256 * 1024 ** 2);
});

test('refuses to report a burst result when the data cap prevents a full test', async () => {
  let time = 0;
  let bytesSent = 0;
  await assert.rejects(sampleSustainedUpload(async bytes => {
    time += bytes * 8 / 2000000;
    bytesSent += bytes;
  }, () => time), UploadLimitError);
  assert.equal(bytesSent, 256 * 1024 ** 2);
});
