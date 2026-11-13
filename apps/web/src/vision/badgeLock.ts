/**
 * Team-coloured lock-badge (chevron) detector for Ban&Pick pick-slot tiles —
 * the authoritative LOCK signal, ported from `badge_strict_counts` in
 * packages/ml-engine/calibrate_vision_regions.py with the SAME intensity
 * gates (a real badge contributes bright solid pixels: warm = r > b + 60 and
 * r >= 150, cool = b > r + 60 and b >= 150; the dim ambient team glow stays
 * below those gates on average, and the ban-phase glow pulse that does bleed
 * in is rejected at the call site by the blank-std gate — see
 * `buildSlotObservations` in pipeline.ts).
 *
 * Probe geometry, measured on the 2800x1260 corpus: the chevron badge sits at
 * the bottom-centre of the tile. Probing INSIDE the slot rect only (never
 * below it) keeps the ban-phase timer glow — which lights up the strip UNDER
 * the tiles — out of the measurement. Corpus validation (frames 028–078 and
 * 222–256, both drafts): locked slots contribute 170–1946 badge pixels at
 * native resolution (ratio >= 0.069 of the ~2470 px probe), true-empty slots
 * 0–10 outside the glow frames; the chosen 0.045 ratio sits between with a
 * >= 1.5x margin, and the residual glow frames are dropped by the std gate.
 */

import type { Rect, RgbaPlane, VisionSide } from './types';

/** Badge probe zone as fractions of the slot rect (measured, inside-tile only). */
export const LOCK_BADGE_PROBE = { fx0: 0.24, fx1: 0.76, fy0: 0.78, fy1: 1.0 } as const;

/** Minimum badge-pixel fraction of the probe area for a confident lock (see module doc). */
export const LOCK_BADGE_MIN_RATIO = 0.045;

/** Strict warm/cool pixel counts of one RGBA rect (port of badge_strict_counts). */
export interface BadgeCounts { warm: number; cool: number }

/** Count bright warm (red-badge) and cool (blue-badge) pixels inside `rect`, clamped to the plane. */
export function badgeStrictCounts(rgba: RgbaPlane, rect: Rect): BadgeCounts {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(rgba.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(rgba.height, Math.ceil(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return { warm: 0, cool: 0 };
  let warm = 0;
  let cool = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = (y * rgba.width + x) * 4;
      const r = rgba.data[p];
      const b = rgba.data[p + 2];
      if (r > b + 60 && r >= 150) warm += 1;
      else if (b > r + 60 && b >= 150) cool += 1;
    }
  }
  return { warm, cool };
}

/** True when the team-coloured lock badge of `side` is confidently present at the bottom-centre of `slotRect`. */
export function detectSlotLockBadge(rgba: RgbaPlane, slotRect: Rect, side: VisionSide): boolean {
  const probe: Rect = {
    x: slotRect.x + LOCK_BADGE_PROBE.fx0 * slotRect.w,
    y: slotRect.y + LOCK_BADGE_PROBE.fy0 * slotRect.h,
    w: (LOCK_BADGE_PROBE.fx1 - LOCK_BADGE_PROBE.fx0) * slotRect.w,
    h: (LOCK_BADGE_PROBE.fy1 - LOCK_BADGE_PROBE.fy0) * slotRect.h,
  };
  const counts = badgeStrictCounts(rgba, probe);
  const area = probe.w * probe.h;
  if (area <= 0) return false;
  const relevant = side === 'red' ? counts.warm : counts.cool;
  return relevant >= LOCK_BADGE_MIN_RATIO * area;
}
