/**
 * Pure, Node-safe grayscale image primitives for the vision layer.
 *
 * Representation: exactly one — Float32Array samples. Raw producers (toGray,
 * resizeGray, cropGray, aspectFit) carry samples in 0..255; normalized images
 * (normalizeGray, and values derived from it such as reference thumbs) carry
 * zero-mean/unit-variance samples and MAY be negative.
 */

import type { GrayImage, Rect, RgbaPlane } from './types';

const FLOAT_VARIANCE_EPSILON = 1e-6;

/** Convert RGBA ImageData to a single-channel luminance image (Rec. 601, samples 0..255). */
export function toGray(imageData: ImageData): GrayImage {
  const { width, height, data } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = Math.round((data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000);
  }
  return { width, height, data: out };
}

/** Extract Rec. 601 opponent chrominance planes (Cb, Cr) from an RGBA plane. */
export function toCbCr(rgba: RgbaPlane): { cb: GrayImage; cr: GrayImage } {
  const { width, height, data } = rgba;
  const n = width * height;
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  return { cb: { width, height, data: cb }, cr: { width, height, data: cr } };
}

/** Crop an RGBA plane clamped to the image bounds (zero-size result when fully outside). */
export function cropRgba(src: RgbaPlane, rect: Rect): RgbaPlane {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(src.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(src.height, Math.ceil(rect.y + rect.h));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  if (w === 0 || h === 0) return { width: w, height: h, data };
  const srcBytes = typeof (src.data as Uint8ClampedArray).subarray === 'function'
    ? (src.data as Uint8ClampedArray)
    : Uint8ClampedArray.from(src.data);
  for (let y = 0; y < h; y += 1) {
    const srcStart = ((y0 + y) * src.width + x0) * 4;
    const dstStart = y * w * 4;
    data.set(srcBytes.subarray(srcStart, srcStart + w * 4), dstStart);
  }
  return { width: w, height: h, data };
}

/** Bilinear-resample a grayscale image to an arbitrary size (edge-clamped, unrounded samples). */
export function resizeGray(src: GrayImage, width: number, height: number): GrayImage {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const out = allocate(w, h);
  if (w === 0 || h === 0 || src.width === 0 || src.height === 0) return out;
  if (w === src.width && h === src.height) {
    out.data.set(src.data);
    return out;
  }
  const xRatio = src.width / w;
  const yRatio = src.height / h;
  for (let y = 0; y < h; y += 1) {
    const sy = clamp((y + 0.5) * yRatio - 0.5, 0, src.height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, src.height - 1);
    const fy = sy - y0;
    const row0 = y0 * src.width;
    const row1 = y1 * src.width;
    const rowOut = y * w;
    for (let x = 0; x < w; x += 1) {
      const sx = clamp((x + 0.5) * xRatio - 0.5, 0, src.width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, src.width - 1);
      const fx = sx - x0;
      const top = src.data[row0 + x0] + (src.data[row0 + x1] - src.data[row0 + x0]) * fx;
      const bottom = src.data[row1 + x0] + (src.data[row1 + x1] - src.data[row1 + x0]) * fx;
      out.data[rowOut + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** Crop a rectangle clamped to the image bounds (zero-size result when fully outside). */
export function cropGray(src: GrayImage, rect: Rect): GrayImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(src.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(src.height, Math.ceil(rect.y + rect.h));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = allocate(w, h);
  if (w === 0 || h === 0) return out;
  for (let y = 0; y < h; y += 1) {
    const srcRow = (y0 + y) * src.width + x0;
    const outRow = y * w;
    for (let x = 0; x < w; x += 1) out.data[outRow + x] = src.data[srcRow + x];
  }
  return out;
}

/** Zero-mean/unit-variance normalization for NCC; constant inputs map to all zeros. */
export function normalizeGray(img: GrayImage): GrayImage {
  const n = img.width * img.height;
  const out = allocate(img.width, img.height);
  if (n === 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += img.data[i];
  const mean = sum / n;
  let squared = 0;
  for (let i = 0; i < n; i += 1) {
    const d = img.data[i] - mean;
    squared += d * d;
  }
  const std = Math.sqrt(squared / n);
  if (std < FLOAT_VARIANCE_EPSILON) return out;
  for (let i = 0; i < n; i += 1) out.data[i] = (img.data[i] - mean) / std;
  return out;
}

/** Letterbox an image onto a flat zero background of the given size, preserving aspect ratio. */
export function aspectFit(img: GrayImage, width: number, height: number): GrayImage {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const out = allocate(w, h);
  if (w === 0 || h === 0 || img.width === 0 || img.height === 0) return out;
  const scale = Math.min(w / img.width, h / img.height);
  const rw = Math.max(1, Math.round(img.width * scale));
  const rh = Math.max(1, Math.round(img.height * scale));
  const resized = resizeGray(img, rw, rh);
  const offsetX = Math.floor((w - rw) / 2);
  const offsetY = Math.floor((h - rh) / 2);
  for (let y = 0; y < rh; y += 1) {
    const srcRow = y * rw;
    const outRow = (offsetY + y) * w + offsetX;
    for (let x = 0; x < rw; x += 1) out.data[outRow + x] = resized.data[srcRow + x];
  }
  return out;
}

/** 64-bit difference hash: the image is resampled to a 9x8 grid; bit (y*8+x) is set when grid[y][x] > grid[y][x+1]. */
export function dHash(img: GrayImage): bigint {
  const grid = resizeGray(img, 9, 8);
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (grid.data[y * 9 + x] > grid.data[y * 9 + x + 1]) hash |= 1n << BigInt(y * 8 + x);
    }
  }
  return hash;
}

/** Hamming distance between two 64-bit hashes (inputs masked to their low 64 bits). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = (a ^ b) & ((1n << 64n) - 1n);
  let count = 0;
  while (x !== 0n) {
    if (x & 1n) count += 1;
    x >>= 1n;
  }
  return count;
}

/** Normalized cross-correlation of two equally sized images in [-1, 1]; 0 for degenerate or size-mismatched input. */
export function ncc(a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height) return 0;
  const n = a.width * a.height;
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a.data[i];
    sumB += b.data[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a.data[i] - meanA;
    const db = b.data[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const denom = Math.sqrt(varianceA * varianceB);
  if (denom < 1e-9) return 0;
  return clamp(covariance / denom, -1, 1);
}

function allocate(width: number, height: number): GrayImage {
  return { width, height, data: new Float32Array(width * height) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
