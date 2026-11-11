'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { decodeTga } = require('../src/portraits');

test('decodes a bottom-up 32-bit TGA into top-down BGRA', () => {
  const header = Buffer.alloc(18);
  header[2] = 2; // uncompressed true-color
  header.writeUInt16LE(1, 12); // width
  header.writeUInt16LE(2, 14); // height
  header[16] = 32;
  header[17] = 8; // 8 alpha bits, bottom-left origin
  const bottom = [1, 2, 3, 255];
  const top = [4, 5, 6, 128];
  const img = decodeTga(Buffer.concat([header, Buffer.from([...bottom, ...top])]));
  assert.deepStrictEqual({ w: img.width, h: img.height }, { w: 1, h: 2 });
  assert.deepStrictEqual([...img.bgra], [...top, ...bottom]);
});
