/**
 * Loader for the hero portrait reference set used by HeroMatcher.
 * Browser-only at call time (fetch + createImageBitmap + canvas); importing
 * this module in Node must not throw.
 *
 * Portrait URLs come from each hero's published `portrait_asset` path
 * (most are `/assets/heroes/{id}.webp`, CN-exclusive portraits are `.jpg`);
 * a source without `portrait_asset` falls back to `/assets/heroes/{id}.webp`.
 */

import { aspectFit, dHash, normalizeGray, resizeGray, toCbCr, toGray } from './geometry';
import type { GrayImage, ReferenceEntry, RgbaPlane } from './types';

/** Minimal hero reference the loader needs; the full `Hero` type satisfies it structurally. */
export interface ReferenceSource { hero_id: number; portrait_asset?: string; variant_assets?: string[] }

/** Options for loading the hero portrait reference set. */
export interface LoadReferenceSetOptions { baseUrl?: string; onProgress?: (done: number, total: number) => void }

/** Minimal 2D-context union used for decoding bitmaps (OffscreenCanvas first, DOM canvas fallback). */
type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Resolve the fetchable portrait URL for one reference source: the hero's
 * published `portrait_asset` when present, else the `/assets/heroes/{id}.webp`
 * fallback, joined onto `baseUrl` when the asset path is root-relative.
 */
export function resolvePortraitUrl(source: ReferenceSource, baseUrl?: string): string {
  const base = (baseUrl ?? '').replace(/\/+$/, '');
  const asset = source.portrait_asset?.trim();
  if (asset) return asset.startsWith('/') ? `${base}${asset}` : asset;
  return `${base}/assets/heroes/${source.hero_id}.webp`;
}

/**
 * Load hashed grayscale thumbnails for every hero source; the portrait URL is
 * taken from the hero's published asset path, and a missing or failed asset is
 * skipped (one failure never aborts the whole set).
 */
export async function loadReferenceSet(
  sources: ReferenceSource[],
  opts: LoadReferenceSetOptions = {},
): Promise<ReferenceEntry[]> {
  const total = sources.length;
  const entries: ReferenceEntry[] = [];
  let done = 0;
  for (const source of sources) {
    const urls = [
      resolvePortraitUrl(source, opts.baseUrl),
      ...(source.variant_assets ?? [])
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => resolvePortraitUrl({ hero_id: source.hero_id, portrait_asset: v }, opts.baseUrl)),
    ];
    for (const url of urls) {
      try {
        const { gray, cb, cr } = await fetchPortraitPlanes(url);
        const small = resizeGray(gray, 32, 32);
        const full64 = normalizeGray(resizeGray(gray, 64, 64));
        entries.push({
          heroId: source.hero_id,
          // Hash is computed on the same normalized 64x64 pipeline HeroMatcher
          // uses for crops, so the dHash shortlist stays aligned end to end.
          hash: dHash(full64),
          thumb: aspectFit(normalizeGray(small), 32, 32),
          // Same normalized 64x64 portrait, kept for the ban matcher's
          // circle-masked/zoomed reference variants (see heroMatcher.ts).
          full64,
          cb64: resizeGray(cb, 64, 64),
          cr64: resizeGray(cr, 64, 64),
        });
      } catch {
        // Single-hero / single-variant failure must not abort the whole set — skip and continue.
      }
    }
    done += 1;
    opts.onProgress?.(done, total);
  }
  return entries;
}

/** Fetch and decode one portrait image (webp/jpg/png) into grayscale and Cb/Cr planes. */
async function fetchPortraitPlanes(url: string): Promise<{ gray: GrayImage; cb: GrayImage; cr: GrayImage }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Portrait ${url}: HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const ctx = createDrawContext(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const plane: RgbaPlane = { width: imageData.width, height: imageData.height, data: imageData.data };
    const { cb, cr } = toCbCr(plane);
    return { gray: toGray(imageData), cb, cr };
  } finally {
    bitmap.close();
  }
}

function createDrawContext(width: number, height: number): DrawContext {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (ctx) return ctx;
  }
  if (typeof document === 'undefined') throw new Error('Canvas 2D is unavailable in this environment.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  return ctx;
}
