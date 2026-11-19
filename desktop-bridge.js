import { once } from 'node:events';

const maxLineBytes = 8192;
const maxPending = 8;
const validId = id => Number.isSafeInteger(id) && id > 0;

// Both pipes belong to the desktop host. A line without a usable ID cannot receive a reply.
export async function runDesktopBridge(call, input = process.stdin, output = process.stdout) {
  const pending = new Map();
  let closed = false;
  function close() {
    closed = true;
    for (const request of pending.values()) request.abort();
  }
  function reply(id, ok, payload) {
    if (!closed && !output.destroyed) output.write(JSON.stringify({ id, ok, payload }) + '\n');
  }
  function dispatch(line) {
    let message;
    try { message = JSON.parse(line.toString('utf8').trim()); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (validId(message.cancel)) {
      pending.get(message.cancel)?.abort();
      return;
    }
    const { id, path, body } = message;
    if (!validId(id) || pending.has(id)) return;
    if (pending.size >= maxPending) {
      reply(id, false, { error: 'Too many requests. Try again after the current operation finishes.' });
      return;
    }
    const request = new AbortController();
    pending.set(id, request);
    void (async () => {
      try {
        const { status, payload } = await call(path, body, request.signal);
        reply(id, status < 400, payload);
      } catch {
        reply(id, false, { error: request.signal.aborted ? 'Request canceled.' : 'Request unavailable.' });
      } finally {
        pending.delete(id);
      }
    })();
  }

  function onOutputError() {
    close();
    input.destroy();
  }
  output.once('error', onOutputError);
  let partial = Buffer.alloc(0);
  let oversized = false;
  try {
    for await (const chunk of input) {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline === -1 ? chunk.length : newline;
        if (partial.length + end - start > maxLineBytes) oversized = true;
        if (!oversized) partial = Buffer.concat([partial, chunk.subarray(start, end)]);
        if (newline === -1) break;
        if (!oversized) dispatch(partial);
        partial = Buffer.alloc(0);
        oversized = false;
        if (output.writableNeedDrain) await once(output, 'drain');
        start = newline + 1;
      }
    }
  } finally {
    close();
    output.removeListener('error', onOutputError);
  }
}
