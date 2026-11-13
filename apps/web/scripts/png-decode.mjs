/**
 * Dependency-free PNG decoder for the vision evaluation tooling.
 *
 * Only Node built-ins are used (node:zlib for IDAT inflation). Supported input:
 * bit depth 8, colour type 2 (RGB) or 6 (RGBA), non-interlaced. All five PNG
 * scanline filters (None/Sub/Up/Average/Paeth) are implemented, and multiple
 * IDAT chunks are concatenated before decompression. Everything else is
 * rejected with a descriptive error so callers never receive silently
 * mis-decoded pixels.
 */
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SUPPORTED_COLOR_TYPES = new Set([2, 6]);
const COLOR_TYPE_CHANNELS = { 2: 3, 6: 4 };
const COLOR_TYPE_NAMES = { 0: 'grayscale', 2: 'RGB', 3: 'palette', 4: 'grayscale+alpha', 6: 'RGBA' };
const FILTER_NAMES = ['None', 'Sub', 'Up', 'Average', 'Paeth'];
const MAX_DIMENSION = 2 ** 31 - 1;

/**
 * Decode a PNG byte buffer into raw RGBA pixels.
 *
 * @param {Buffer|Uint8Array} buffer Raw bytes of a PNG file.
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA pixels,
 *   row-major, exactly 4 bytes per pixel (width*height*4 entries).
 * @throws {Error} When the signature, IHDR fields, chunk layout or filter
 *   stream are invalid/unsupported. Unsupported colour types (0 grayscale,
 *   3 palette, 4 gray+alpha) and interlaced images are always rejected.
 */
export function decodePng(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < PNG_SIGNATURE.length + 12) {
    throw new Error('PNG terlalu pendek: tidak memuat signature + IHDR minimal.');
  }
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Signature PNG tidak valid (harus 89 50 4E 47 0D 0A 1A 0A).');
  }

  const chunks = readChunks(bytes);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR');
  if (!ihdr) throw new Error('Chunk IHDR tidak ditemukan.');

  const header = parseIHDR(ihdr.data);
  const channels = COLOR_TYPE_CHANNELS[header.colorType];

  const idat = chunks.filter(chunk => chunk.type === 'IDAT');
  if (idat.length === 0) throw new Error('Chunk IDAT tidak ditemukan.');
  const compressed = Buffer.concat(idat.map(chunk => chunk.data));

  let raw;
  try {
    raw = inflateSync(compressed);
  } catch (error) {
    throw new Error(`Data IDAT gagal didekompresi (zlib inflate): ${error.message}`);
  }

  const stride = header.width * channels;
  const expected = header.height * (stride + 1);
  if (raw.length < expected) {
    throw new Error(`Data scanline terlalu pendek: dibutuhkan ${expected} byte, diterima ${raw.length}.`);
  }
  if (raw.length !== expected) {
    throw new Error(`Panjang data scanline tidak pas: dibutuhkan ${expected} byte, diterima ${raw.length}.`);
  }

  return { width: header.width, height: header.height, data: unfilterScanlines(raw, header.width, header.height, channels) };
}

/** Parse one PNG chunk stream into `{ type, data }` records (CRC bytes are skipped). */
function readChunks(bytes) {
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (length > MAX_DIMENSION || dataStart + length + 4 > bytes.length) {
      throw new Error(`Chunk '${type}' melebihi batas buffer (length=${length}).`);
    }
    chunks.push({ type, data: bytes.subarray(dataStart, dataStart + length) });
    offset = dataStart + length + 4; // skip trailing CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

/** Validate IHDR payload and return { width, height, colorType, bitDepth, interlace }. */
function parseIHDR(data) {
  if (data.length < 13) throw new Error('Payload IHDR lebih pendek dari 13 byte.');
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  const compression = data[10];
  const filterMethod = data[11];
  const interlace = data[12];

  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Dimensi IHDR tidak valid: ${width}x${height}.`);
  }
  if (bitDepth !== 8) {
    throw new Error(`Bit depth ${bitDepth} tidak didukung; hanya bit depth 8 (corpus & referensi memakai 8).`);
  }
  if (!SUPPORTED_COLOR_TYPES.has(colorType)) {
    throw new Error(
      `Colour type ${colorType} (${COLOR_TYPE_NAMES[colorType] ?? 'tidak dikenal'}) tidak didukung; ` +
      'hanya colour type 2 (RGB) dan 6 (RGBA). Gunakan langkah konversi Python (convert_reference_images.py) bila perlu.',
    );
  }
  if (compression !== 0) throw new Error(`Metode kompresi ${compression} tidak didukung (harus 0/deflate).`);
  if (filterMethod !== 0) throw new Error(`Metode filter ${filterMethod} tidak didukung (harus 0).`);
  if (interlace !== 0) {
    throw new Error('Gambar interlaced (Adam7) tidak didukung; simpan ulang PNG tanpa interlacing.');
  }
  return { width, height, colorType, bitDepth, interlace };
}

/**
 * Undo the per-scanline PNG filters and interleave the channel planes into
 * RGBA byte order. Unfiltered pixel channels are copied as-is, so callers
 * must expand RGB -> RGBA afterwards (handled here in the same pass).
 */
function unfilterScanlines(raw, width, height, channels) {
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    if (filter > 4) {
      throw new Error(`Filter scanline ${filter} tidak dikenal di baris ${y} (harus 0..4).`);
    }
    const src = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = y > 0 ? previous[i] : 0;
      // RFC 2083 section 6: for the FIRST pixel of a scanline both the left
      // neighbour (a) and the above-left neighbour (c) are treated as zero;
      // there is NO wrap to the previous row's last pixel. (Sub/Average use
      // the same zero `a`; Up uses only `b`.)
      const upLeft = i >= channels && y > 0 ? previous[i - channels] : 0;
      let value = src[i];
      switch (filter) {
        case 0: // None
          break;
        case 1: // Sub
          value += left;
          break;
        case 2: // Up
          value += up;
          break;
        case 3: // Average
          value += (left + up) >> 1;
          break;
        case 4: // Paeth
          value += paethPredictor(left, up, upLeft);
          break;
      }
      line[i] = value & 0xff;
    }
    expandToRgba(line, width, channels, out, y);
    previous.set(line);
  }
  return out;
}

/** Copy one unfiltered scanline into the RGBA output plane (RGB is expanded, alpha forced to 255). */
function expandToRgba(line, width, channels, out, y) {
  const outRow = y * width * 4;
  for (let x = 0; x < width; x += 1) {
    const s = x * channels;
    const d = outRow + x * 4;
    out[d] = line[s];
    out[d + 1] = line[s + 1];
    out[d + 2] = line[s + 2];
    out[d + 3] = channels === 4 ? line[s + 3] : 255;
  }
}

/** PNG Paeth predictor (section 6.3 of the PNG specification). */
function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

/** Human-readable filter name list, used by tests and diagnostics. */
export function filterNames() {
  return [...FILTER_NAMES];
}
