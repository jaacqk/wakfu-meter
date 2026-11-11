'use strict';

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

// Follows a growing text file by polling, emitting complete lines.
// Handles Wakfu's log rotation (file replaced by a smaller one) and
// the file not existing yet.
function tailLines(path, onLines, onStatus, intervalMs = 250) {
  let offset = 0;
  let decoder = new StringDecoder('utf8');
  let partial = '';
  let busy = false;
  let missing = null;

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const { size } = await fs.promises.stat(path);
      if (missing !== false) onStatus({ ok: true, path });
      missing = false;
      if (size < offset) {
        offset = 0;
        decoder = new StringDecoder('utf8');
        partial = '';
      }
      if (size > offset) {
        const fh = await fs.promises.open(path, 'r');
        try {
          const buf = Buffer.alloc(size - offset);
          const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
          offset += bytesRead;
          const lines = (partial + decoder.write(buf.subarray(0, bytesRead))).split(/\r?\n/);
          partial = lines.pop();
          if (lines.length) onLines(lines);
        } finally {
          await fh.close();
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (missing !== true) onStatus({ ok: false, path });
      missing = true;
      offset = 0;
    } finally {
      busy = false;
    }
  }

  poll();
  const timer = setInterval(poll, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { tailLines };
