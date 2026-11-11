'use strict';

// Reads the class portraits from the player's own Wakfu install
// (contents/gui_jar/gui.jar, a zip of TGA images). Nothing is copied
// into this project.

const fs = require('fs');
const zlib = require('zlib');

const PREFIX = 'breeds/illustrations/portrait80/';

// Minimal zip reader: returns { name: Buffer } for entries starting with prefix.
function readZipEntries(path, prefix) {
  const fd = fs.openSync(path, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('fin de zip introuvable');
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);

    const out = {};
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (!name.startsWith(prefix) || name.endsWith('/')) continue;

      const local = Buffer.alloc(30);
      fs.readSync(fd, local, 0, 30, localOffset);
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const data = Buffer.alloc(compSize);
      fs.readSync(fd, data, 0, compSize, dataStart);
      if (method === 0) out[name.slice(prefix.length)] = data;
      else if (method === 8) out[name.slice(prefix.length)] = zlib.inflateRawSync(data);
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

// Decodes an uncompressed 24/32-bit TGA into top-down BGRA pixels.
function decodeTga(buf) {
  const idLen = buf[0];
  const type = buf[2];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const topDown = (buf[17] & 0x20) !== 0;
  if (type !== 2 || (bpp !== 32 && bpp !== 24)) return null;
  const src = 18 + idLen + buf.readUInt16LE(5) * Math.ceil(buf[7] / 8); // skip id + color map
  const step = bpp / 8;
  const bgra = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = src + (row * width + x) * step;
      const d = (y * width + x) * 4;
      bgra[d] = buf[s];
      bgra[d + 1] = buf[s + 1];
      bgra[d + 2] = buf[s + 2];
      bgra[d + 3] = step === 4 ? buf[s + 3] : 255;
    }
  }
  return { width, height, bgra };
}

// Returns { "<breedId><sex>": { width, height, bgra } }, e.g. "90" = Crâ male.
function loadPortraits(guiJarPath) {
  const images = {};
  for (const [file, buf] of Object.entries(readZipEntries(guiJarPath, PREFIX))) {
    const m = /^(\d+)\.tga$/.exec(file);
    const img = m && decodeTga(buf);
    if (img) images[m[1]] = img;
  }
  return images;
}

module.exports = { loadPortraits, decodeTga };
