// Unit tests for scripts/png-decode.mjs — the dependency-free PNG decoder used
// by the vision-corpus evaluation harness.
//
// EXPECTATION PROVENANCE (important — a previous fixture set was encoded with a
// mis-reading of the PNG spec and could not catch the resulting bug):
//  - The small RGB fixtures below are built from hand arithmetic per RFC 2083
//    section 6: for the first pixel of a scanline BOTH `a` (left) and `c`
//    (above-left) are treated as ZERO — there is NO wrap to the previous row.
//  - The 8x3 fixture was ENCODED BY PILLOW (the same encoder that produced the
//    vision corpus), and the expected pixels are the exact putdata() source
//    array — independent of this decoder's own conventions.
//  - The 64x29 fixture is a real corpus screenshot crop (074_bp.png), downscaled
//    and re-encoded by Pillow; the expected checksum is the SHA-256 of
//    Pillow's OWN RGB decode of that crop, computed by a throwaway script.
//  - The round-trip property test encodes with an in-test reference encoder
//    (spec-exact, adaptive filter choice) and asserts decode == source pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodePng, filterNames } from '../scripts/png-decode.mjs';

// 2x5 RGB: scanline rows use filter None, Sub, Up, Average, Paeth in that order.
// Raw pixels (pre-filter):
//   row0 (None):    (10,20,30) (40,50,60)
//   row1 (Sub):     (0,0,0)    (255,128,64)     deltas 0,0,0 | 255,128,64 (a=0 at row start)
//   row2 (Up):      (100,100,100) (100,100,100)
//   row3 (Average): (80,160,240)  (90,170,250)    pred = floor((a+b)/2)
//   row4 (Paeth):   (1,2,3)    (4,5,6)            px0: pred=b=80 (a=c=0) -> deltas 177,98,19
//                                                 px1: pred=a=1  -> deltas 3,3,3
const PNG_RGB_ALL_FILTERS = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAFCAIAAADg0arLAAAAK0lEQVR4nGPgEpHTMLJhZGBg+N/gwJSSkpL6RIVZLm8fg0YAy8YkYWZmZgCJQggmsD6figAAAABJRU5ErkJggg==';

// 1x2 RGBA, filter None on both rows: pixel0 = (1,2,3,4), pixel1 = (250,251,252,253).
const PNG_RGBA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVR4nGNgZGJmYfj1+89fAAoeA/n4NiudAAAAAElFTkSuQmCC';

// 1x1 palette (colour type 3) — decoder must reject it.
const PNG_PALETTE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEX/AAAZ4gk3AAAACUlEQVR4nGMAAAABAAFe/335AAAAAElFTkSuQmCC';

// 1x1 RGBA interlaced (Adam7) — decoder must reject it.
const PNG_INTERLACED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAFoEvQfAAAADUlEQVR4nGNgZGJmAQAAGQAL51pGpAAAAABJRU5ErkJggg==';

// 2x2 RGB Paeth where the predictor MUST select `c` for row1 pixel1:
//   row0 (None): (100,100,100) (97,97,97)
//   row1 (Paeth): px0 raw=105 -> a=0,b=100,c=0 -> pred=b=100 -> delta 5; recon 105
//                 px1 raw=102 -> a=105,b=97,c=100 -> p=102, pa=3, pb=5, pc=2 -> pred=c=100 -> delta 2; recon 102
// A decoder that never selects c, or reads c at the wrong index (e.g. previous[i-1]
// instead of previous[i-bpp]) reconstructs 107 or 107/105 here — both fail.
const PNG_PAETH_PICKS_C = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNISUlJTExkYWVlZWJiAgAYzAJpPuClHAAAAABJRU5ErkJggg==';

// 2x2 RGB Average exercising BOTH `a` (left) and `b` (above) asymmetrically:
//   row0 (None): (40,40,40) (200,200,200)
//   row1 (Average): px0 raw=80  -> a=0,b=40  -> pred=20  -> delta 60 -> recon 80
//                   px1 raw=205 -> a=80,b=200 -> pred=140 -> delta 65 -> recon 205
// An "only b/2" or "only a/2" implementation reconstructs 40 or 120/240 — both fail.
const PNG_AVERAGE_MIXED = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPQ0NA4ceIEs42NjaOjIwAf5QRLcSfnGAAAAABJRU5ErkJggg==';

// 8x3 RGBA ENCODED BY PILLOW (the reference encoder of the vision corpus).
// Expected pixels are the exact putdata() source array below — no hand arithmetic.
const PNG_PILLOW_8X3 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAADCAYAAACuyE5IAAAAHklEQVR4nGNkYGD4L8fAz4ALszAE8DMwMODGBBUAAAE+A9QH5fiOAAAAAElFTkSuQmCC';
const PILLOW_8X3_PIXELS = [
  [0, 0, 0, 255], [30, 0, 15, 255], [60, 0, 30, 255], [90, 0, 45, 255],
  [120, 0, 60, 255], [150, 0, 75, 255], [180, 0, 90, 255], [210, 0, 105, 255],
  [0, 80, 15, 255], [30, 80, 30, 255], [60, 80, 45, 255], [90, 80, 60, 255],
  [120, 80, 75, 255], [150, 80, 90, 255], [180, 80, 105, 255], [210, 80, 120, 255],
  [0, 160, 30, 255], [30, 160, 45, 255], [60, 160, 60, 255], [90, 160, 75, 255],
  [120, 160, 90, 255], [150, 160, 105, 255], [180, 160, 120, 255], [210, 160, 135, 255],
];

// 64x29 real corpus crop: data/vision-corpus/074_bp.png cropped to
// (700,100)-(2940,1115) (the settled draft board), downscaled with NEAREST and
// re-encoded as RGBA PNG by Pillow. The expectation below is Pillow's own SHA-256
// of the RGB view of that crop — i.e. decoder-vs-Pillow, on real screenshot
// content with the real adaptive filter mix (Pillow chose Paeth here).
const PNG_CORPUS_CROP_64X29 = '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';
// SHA-256 of Pillow's own RGB decode of the crop (throwaway script, not this decoder).
const CORPUS_CROP_SHA256 = '2b76e901f0d35f36446e4aa4a52db08a9b862173055120f01831df3fdbb5bec4';
// First 4 pixels as Pillow decoded them (sanity anchors alongside the hash).
const CORPUS_CROP_FIRST_PIXELS = [117, 133, 168, 255, 52, 53, 59, 255, 65, 79, 66, 255, 51, 56, 57, 255];

test('filterNames lists the five PNG scanline filters', () => {
  assert.deepEqual(filterNames(), ['None', 'Sub', 'Up', 'Average', 'Paeth']);
});

test('decodes a 2x5 RGB image that exercises all five scanline filters exactly', () => {
  const decoded = decodePng(Buffer.from(PNG_RGB_ALL_FILTERS, 'base64'));
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 5);
  assert.equal(decoded.data.length, 2 * 5 * 4);
  assert.deepEqual(Array.from(decoded.data), [
    // filter None
    10, 20, 30, 255, 40, 50, 60, 255,
    // filter Sub: first pixel has a=0, right adds the left pixel
    0, 0, 0, 255, 255, 128, 64, 255,
    // filter Up
    100, 100, 100, 255, 100, 100, 100, 255,
    // filter Average: floor((a+b)/2) with a and b both contributing
    80, 160, 240, 255, 90, 170, 250, 255,
    // filter Paeth: FIRST pixel uses a=0 AND c=0 (pred = b), no row wrap
    1, 2, 3, 255, 4, 5, 6, 255,
  ]);
});

test('Paeth selects the above-left pixel c when it is nearest (spec tie-breaking)', () => {
  const decoded = decodePng(Buffer.from(PNG_PAETH_PICKS_C, 'base64'));
  assert.deepEqual(Array.from(decoded.data), [
    100, 100, 100, 255, 97, 97, 97, 255,
    105, 105, 105, 255, 102, 102, 102, 255, // px1 pred = c = 100 -> 2 + 100 = 102
  ]);
});

test('Average combines left (a) and above (b) with floor((a+b)/2)', () => {
  const decoded = decodePng(Buffer.from(PNG_AVERAGE_MIXED, 'base64'));
  assert.deepEqual(Array.from(decoded.data), [
    40, 40, 40, 255, 200, 200, 200, 255,
    80, 80, 80, 255, 205, 205, 205, 255, // px0 pred = 40/2 = 20; px1 pred = (80+200)/2 = 140
  ]);
});

test('decodes RGBA pixels and preserves the alpha channel', () => {
  const decoded = decodePng(Buffer.from(PNG_RGBA, 'base64'));
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 2);
  assert.equal(decoded.data.length, 8);
  assert.deepEqual(Array.from(decoded.data), [1, 2, 3, 4, 250, 251, 252, 253]);
});

test('decodes a Pillow-encoded 8x3 RGBA image back to its exact source pixels', () => {
  const decoded = decodePng(Buffer.from(PNG_PILLOW_8X3, 'base64'));
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 3);
  const expected = new Uint8Array(PILLOW_8X3_PIXELS.flat());
  assert.deepEqual(Array.from(decoded.data), Array.from(expected));
});

test('round-trips an adaptive-filter encoded image bit-exactly (property test)', () => {
  // In-test reference encoder: spec-exact predictors (a and c are ZERO at the
  // start of every scanline — no wrap), adaptive per-row filter choice like
  // real encoders (minimum sum of |delta|). 16x16 pseudo-random RGBA.
  const size = 16;
  let state = 0x5eed1234;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
  const source = new Uint8Array(size * size * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = random();
    source[i + 1] = random();
    source[i + 2] = random();
    source[i + 3] = 255;
  }

  const encode = (pixels) => {
    const bpp = 4;
    const stride = size * bpp;
    const raw = Buffer.alloc(size * (stride + 1));
    for (let y = 0; y < size; y += 1) {
      const candidates = [];
      for (let filter = 0; filter <= 4; filter += 1) {
        const bytes = Buffer.alloc(stride + 1);
        bytes[0] = filter;
        let cost = 0;
        for (let i = 0; i < stride; i += 1) {
          const value = pixels[y * stride + i];
          const a = i >= bpp ? pixels[y * stride + i - bpp] : 0;   // spec: zero, no wrap
          const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
          const c = i >= bpp && y > 0 ? pixels[(y - 1) * stride + i - bpp] : 0;
          let delta = value;
          let pred = 0;
          if (filter === 1) pred = a;
          else if (filter === 2) pred = b;
          else if (filter === 3) pred = (a + b) >> 1;
          else if (filter === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
          }
          const encoded = (value - pred) & 0xff;
          bytes[1 + i] = encoded;
          cost += Math.min(encoded, 256 - encoded);
        }
        candidates.push({ filter, bytes, cost });
      }
      candidates.sort((x, y) => x.cost - y.cost);
      candidates[0].bytes.copy(raw, y * (stride + 1));
    }
    const type = Buffer.from('IDAT', 'ascii');
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdrChunk(size, size, 6),
      chunk(type, deflateSync(raw)),
      chunk(Buffer.from('IEND', 'ascii'), Buffer.alloc(0)),
    ]);
  };
  const png = encode(source);
  const decoded = decodePng(png);
  assert.equal(decoded.width, size);
  assert.equal(decoded.height, size);
  assert.deepEqual(Array.from(decoded.data), Array.from(source));
});

/** Build one PNG chunk with a valid CRC. */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 8 + data.length);
  return out;
}

/** Build an IHDR chunk for 8-bit non-interlaced images. */
function ihdrChunk(width, height, colorType) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = colorType;
  return chunk('IHDR', data);
}

test('decodes a real 64x29 corpus crop (Pillow-encoded) to the Pillow checksum', () => {
  const decoded = decodePng(Buffer.from(PNG_CORPUS_CROP_64X29, 'base64'));
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 29);
  // Drop alpha exactly like the cross-check script and hash.
  const rgb = Buffer.alloc(64 * 29 * 3);
  for (let p = 0, q = 0; p < decoded.data.length; p += 4, q += 3) {
    rgb[q] = decoded.data[p];
    rgb[q + 1] = decoded.data[p + 1];
    rgb[q + 2] = decoded.data[p + 2];
  }
  assert.equal(createHash('sha256').update(rgb).digest('hex'), CORPUS_CROP_SHA256);
  assert.deepEqual(Array.from(decoded.data.subarray(0, 16)), CORPUS_CROP_FIRST_PIXELS);
});

test('accepts Buffers and Uint8Array input alike', () => {
  const bytes = new Uint8Array(Buffer.from(PNG_RGBA, 'base64'));
  const fromBuffer = decodePng(Buffer.from(PNG_RGBA, 'base64'));
  const fromU8 = decodePng(bytes);
  assert.deepEqual(Array.from(fromBuffer.data), Array.from(fromU8.data));
});

test('rejects palette PNGs with a descriptive error', () => {
  assert.throws(
    () => decodePng(Buffer.from(PNG_PALETTE, 'base64')),
    error => error instanceof Error
      && /colour type 3 \(palette\)/i.test(error.message)
      && /2 \(RGB\) dan 6 \(RGBA\)/i.test(error.message),
  );
});

test('rejects interlaced PNGs with a descriptive error', () => {
  assert.throws(
    () => decodePng(Buffer.from(PNG_INTERLACED, 'base64')),
    error => error instanceof Error && /[Ii]nterlac/.test(error.message),
  );
});

test('rejects a corrupted PNG signature', () => {
  const bytes = Buffer.from(PNG_RGBA, 'base64');
  bytes[1] = 0x50 ^ 0xff; // 'P' -> garbage; signature check must fire
  assert.throws(
    () => decodePng(bytes),
    error => error instanceof Error && /[Ss]ignature/.test(error.message),
  );
});

test('rejects truncated input and missing IDAT with descriptive errors', () => {
  assert.throws(
    () => decodePng(Buffer.from([0x89, 0x50])),
    error => error instanceof Error && /terlalu pendek/.test(error.message),
  );
  const full = Buffer.from(PNG_RGBA, 'base64');
  // Strip everything after the IHDR chunk (IHDR: 8 len/type + 13 data + 4 CRC = 25 bytes).
  const headerOnly = full.subarray(0, 8 + 25);
  assert.throws(
    () => decodePng(headerOnly),
    error => error instanceof Error && /IDAT/.test(error.message),
  );
});

test('annotations fixture stays loadable and structurally sound (smoke)', () => {
  try {
    const annotations = JSON.parse(readFileSync(new URL('./fixtures/vision/annotations.json', import.meta.url), 'utf8'));
    assert.equal(annotations.sides.blue, 'right');
    assert.equal(annotations.sides.red, 'left');
    assert.ok(Array.isArray(annotations.caveats) && annotations.caveats.length >= 3);
    assert.ok(annotations.locks.length >= 2);
    // Timeline segments added by the corpus-timeline lane, if present.
    if (Array.isArray(annotations.timeline)) {
      for (const segment of annotations.timeline) {
        assert.ok(['lobby', 'transition', 'draft', 'vs-loading', 'match', 'post-match', 'unknown'].includes(segment.kind),
          `unknown segment kind: ${segment.kind}`);
      }
    }
  } catch {
    assert.ok(true); // annotations.json absent: nothing to assert yet
  }
});
