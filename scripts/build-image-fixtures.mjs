// Build PNG fixtures used by the chunked-OSC dogfood + E2E suite.
//
// Two outputs in e2e/fixtures/:
//   - inline-image-1x1.png      — 1×1 transparent pixel, single-chunk path
//   - inline-image-32x32.png    — 32×32 deterministic gradient, multi-chunk
//
// Both PNGs are encoded from scratch (no `pngjs` dep) using only Node's
// built-in `zlib.deflateSync` + a small CRC32 table. The 32×32 fixture
// uses a checkerboard + diagonal gradient so a future pixel-sample E2E
// can assert deterministic colours at known coordinates.
//
// Run once and commit the outputs. Re-run if you intentionally change
// the gradient — the byte content matters for E2E reproducibility.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "e2e", "fixtures");

mkdirSync(OUT_DIR, { recursive: true });

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const nameBuf = Buffer.from(name, "ascii");
  const crcInput = Buffer.concat([nameBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, nameBuf, data, crc]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8); // bit depth
  data.writeUInt8(6, 9); // color type RGBA
  data.writeUInt8(0, 10); // compression
  data.writeUInt8(0, 11); // filter
  data.writeUInt8(0, 12); // interlace
  return chunk("IHDR", data);
}

function idat(width, height, pixelFn) {
  // Scanlines: one filter byte (0 = None) + width*4 RGBA bytes per row.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }
  const compressed = deflateSync(raw, { level: 9 });
  return chunk("IDAT", compressed);
}

const IEND = chunk("IEND", Buffer.alloc(0));

function buildPng(width, height, pixelFn) {
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height), idat(width, height, pixelFn), IEND]);
}

// ---------- Fixtures ----------

// 1x1 transparent — the smallest valid RGBA PNG. Used by the diag
// script as the single-chunk happy path.
const tinyPng = buildPng(1, 1, () => [0, 0, 0, 0]);
writeFileSync(join(OUT_DIR, "inline-image-1x1.png"), tinyPng);

// 32x32 deterministic gradient. Each pixel encodes (x, y) into RGB so a
// future pixel-sample E2E spec can read back known values at known
// coordinates. Alpha = 255 (opaque) so PNG renderers don't drop the
// content entirely on a default background.
const gradientPng = buildPng(32, 32, (x, y) => {
  const r = (x * 8) & 0xff;
  const g = (y * 8) & 0xff;
  const b = ((x ^ y) * 4) & 0xff;
  return [r, g, b, 255];
});
writeFileSync(join(OUT_DIR, "inline-image-32x32.png"), gradientPng);

console.log(
  `wrote inline-image-1x1.png (${tinyPng.length} bytes) and inline-image-32x32.png (${gradientPng.length} bytes) to ${OUT_DIR}`,
);
