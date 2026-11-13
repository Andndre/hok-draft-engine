/**
 * dHash-shortlisted, NCC-scored matcher that maps a captured slot crop to a
 * hero id from a preloaded ReferenceEntry set. Pure TS, no DOM, no engine deps.
 *
 * Zoom search (PICK path): the in-game slot portrait is the SAME illustration
 * as the 128x128 reference portrait but displayed ~1.3–1.6x more zoomed in,
 * and the team-coloured lock badge overlaps the slot's bottom-centre ~20%. A
 * naive full-crop resize therefore does not align with the reference and
 * under-scores the correct hero. `match` therefore scores a small candidate
 * set of sub-crops (badge-trimmed top ~80%, horizontal ±4 px offsets against
 * the role crest that straddles the tile's top-left corner, and centred
 * zoom-ins at 0.9/0.8/0.7/0.62 with small vertical offsets) and keeps the best
 * score. The dHash shortlist is computed PER CANDIDATE crop so the zoom can
 * never push the true hero out of the shortlist (verified empirically on the
 * corpus: see packages/ml-engine/calibrate_vision_regions.py +
 * evaluate-vision-corpus.mjs). Abstention (`minScore`, `minMargin`) applies to
 * the best candidate exactly as before, so the public
 * `match(crop): MatchResult` contract is unchanged.
 *
 * ORB follow-up note: the tie-break seam is inside `match`, right after the
 * NCC `scored.sort(...)` — when `margin < minMargin`, an async variant could
 * lazy-load `@techstark/opencv-js` and refine the top-2 candidates with ORB
 * feature matching before applying abstention. Deferred in this lane to keep
 * the sync `match(crop): MatchResult` contract and avoid the heavy wasm dep.
 *
 * Ban circles (BAN path): the in-game ban icon is a CIRCLE-MASKED portrait —
 * the 64 px icon's corners are the dark panel behind it, and a white padlock
 * overlay covers its bottom-right. Comparing that circle against a SQUARE
 * reference (the legacy behaviour below) measures two different
 * representations and caps every score far below the pick threshold (measured
 * max 0.677 over 456 ban slot-frames, with a live false positive). The ban
 * path instead scores a MASKED NCC — circle r=31 centred in the 64x64 prep
 * minus the padlock rectangle — against per-reference "ban-style" variants:
 * each reference's normalized 64x64 portrait is virtually cropped by a zoom
 * factor and small offsets and compared inside the same mask (NCC is affine
 * invariant, so un-normalized variants are exactly equivalent to normalized
 * ones). A cheap coarse pass (2 zoom variants, full reference scan) ranks the
 * set and shortlists BAN_SHORTLIST_SIZE heroes for the fine variant grid;
 * abstention then applies the per-kind ban thresholds. Ground truth for the
 * six corpus draft-#1 bans (apps/web/tests/fixtures/vision/
 * ban-identity-ground-truth.json) measured the separation this implements:
 * correct identified winners score >= 0.834 with margins >= 0.20, wrong
 * winners never exceed 0.640 with margins <= 0.02, at capture scales
 * 1.0 / 0.686 / 0.5 — the thresholds below sit inside that gap. The two
 * unidentifiable icons (Daji vs Kongkong'er, Luna vs Xuance — arts that stay
 * within ~0.02 of each other inside the visible circle) abstain by design.
 * Legacy behaviour (no `full64` on the references) is preserved verbatim so
 * callers that predate the field keep their exact scores.
 *
 * Safety: a surviving ban identity is an ESTIMATE (`estimated: true`, see
 * pipeline.buildSlotObservations) that is folded into the same soft path as an
 * unidentified ban — it never enters the draft position, so a wrong ban can
 * never remove a hero from the recommendation pool.
 */

import type { GrayImage, MatchCandidate, MatchResult, ReferenceEntry, RgbaPlane } from './types';
import { aspectFit, cropGray, cropRgba, dHash, hammingDistance, ncc, normalizeGray, resizeGray, toCbCr } from './geometry';

/** Tunables controlling HeroMatcher shortlisting and abstention. `banMinScore`/`banMinMargin` apply to BAN crops only (see DEFAULTS). */
export interface HeroMatcherOptions { shortlistSize?: number; minScore?: number; minMargin?: number; banMinScore?: number; banMinMargin?: number; banShortlistSize?: number }

/**
 * Abstention defaults. `banMinScore = 0.72` / `banMinMargin = 0.10` are
 * MEASURED against operator-supplied ground truth for the six corpus draft-#1
 * bans (ban-identity-ground-truth.json), not tuned: with the ban-specific
 * circle-masked matcher the correctly identified bans (Li Xin #507, Xuance
 * #195, Dunshan #509, Arke #116) score 0.834–0.923 with top-1-vs-top-2 margins
 * 0.20–0.33 across every corpus frame at capture scales 1.0/0.686/0.5, while
 * the best WRONG hero on any ban crop never exceeds 0.640 with a margin above
 * 0.02. 0.72 sits >= 0.08 above the wrong-hero ceiling and >= 0.11 below the
 * correct cluster; the margin floor 0.10 sits far above every measured
 * wrong-winner margin. The two ambiguous icons (Daji #109 best 0.584–0.631,
 * Luna #146 best 0.617–0.671 with ~0.00 margin against their confusables)
 * abstain under these thresholds instead of guessing. Pick slots keep the
 * original 0.55/0.04 that produced 10/10 identities on corpus frame 78.
 */
const DEFAULTS = {
  shortlistSize: 12,
  minScore: 0.55,
  minMargin: 0.04,
  banMinScore: 0.72,
  banMinMargin: 0.10,
  banShortlistSize: 10,
} as const;

/** Fraction of the slot box kept when cropping away the bottom lock badge. */
export const ZOOM_BADGE_TRIM_RATIO = 0.8;
/** Horizontal candidate offsets (px) that dodge the role crest at the tile's top-left. */
export const ZOOM_DX_OFFSETS = [-4, 0, 4] as const;
/** Centred zoom-in scales applied to the badge-trimmed source. */
export const ZOOM_SCALES = [0.9, 0.8, 0.7, 0.62] as const;
/** Vertical offsets (fraction of source height) for the 0.9/0.8 zoom-ins. */
export const ZOOM_DY_RATIOS = [0, 0.06, -0.06] as const;
/**
 * Legacy ban candidate: the upper-left square below this fraction avoids the
 * bottom-right padlock overlay. LEGACY FALLBACK ONLY — superseded by the
 * circle-masked ban path (which activates whenever references carry `full64`).
 */
export const BAN_PADLOCK_AVOID_RATIO = 0.72;

// ---------------------------------------------------------------------------
// Ban-path geometry (all measured on the corpus; see module doc).
// ---------------------------------------------------------------------------

/** Ban-circle radius (px in the 64x64 ban prep space) excluding the anti-aliased edge against the panel. */
export const BAN_CIRCLE_RADIUS = 31;
/** Padlock exclusion rect origin as a fraction of the 64x64 icon (measured: the padlock body+shackle live at x>=0.6, y>=0.5). */
export const BAN_PADLOCK_EXCLUSION = { x: 0.6, y: 0.5 } as const;
/** Coarse ranking zooms applied to the reference before the fine grid (cheap full-set scan). */
export const BAN_COARSE_ZOOMS = [1.0, 1.3] as const;
/** Fine-grid zoom factors of the reference's central crop (measured in-game ban zooms span 1.0–1.3; 1.45/1.6 keep head-room for other art). */
export const BAN_ZOOM_SCALES = [1.0, 1.1, 1.2, 1.3, 1.45, 1.6] as const;
/** Fine-grid horizontal offsets (px) of the reference's central crop. */
export const BAN_DX_OFFSETS = [-4, -2, 0, 2, 4, 6] as const;
/** Fine-grid vertical offsets (px) of the reference's central crop. */
export const BAN_DY_OFFSETS = [-4, -2, 0, 2] as const;

/** Module-level ban mask (circle minus padlock rect) in the 64x64 prep space; deterministic. */
const BAN_MASK: Uint8Array = (() => {
  const size = 64;
  const mask = new Uint8Array(size * size);
  const cx = 31.5;
  const cy = 31.5;
  const r = BAN_CIRCLE_RADIUS;
  const x0 = Math.round(size * BAN_PADLOCK_EXCLUSION.x);
  const y0 = Math.round(size * BAN_PADLOCK_EXCLUSION.y);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      mask[y * size + x] = dx * dx + dy * dy <= r * r && !(x >= x0 && y >= y0) ? 1 : 0;
    }
  }
  return mask;
})();

/** One-time masked moments of the prepared ban crop (computed once per match call). */
interface PrepMoments { sa: number; saa: number }

/** Compute the masked first/second moments of `image` over BAN_MASK. */
function maskedMoments(image: GrayImage): PrepMoments {
  let sa = 0;
  let saa = 0;
  const data = image.data;
  for (let i = 0; i < BAN_MASK.length; i += 1) {
    if (!BAN_MASK[i]) continue;
    const v = data[i];
    sa += v;
    saa += v * v;
  }
  return { sa, saa };
}

/** Precomputed bilinear sampling taps of one ban variant config over the MASKED pixels only (shared across references and crops). */
interface BanSamplePlan { count: number; idx: Int32Array; wts: Float32Array }

/** Per-config ban sampling plans; keyed "zoom|dx|dy" (pure function of the config, so module-level caching is safe). */
const BAN_SAMPLE_PLANS = new Map<string, BanSamplePlan>();

/**
 * Build (or fetch) the sampling plan for one ban variant config: for every
 * masked 64x64 output pixel, the four bilinear taps into the clamped central
 * crop window (EXACTLY cropGray's clamping semantics and resizeGray's
 * interpolation formulas; an identity window collapses to a single tap with
 * weight 1). Entries are [outIndex, i0, i1, i2, i3] + [w0, w1, w2, w3].
 */
function banSamplePlan(zoom: number, dx: number, dy: number): BanSamplePlan {
  const key = `${zoom}|${dx}|${dy}`;
  const cached = BAN_SAMPLE_PLANS.get(key);
  if (cached) return cached;
  const side = Math.max(8, Math.round(64 / zoom));
  const ox = Math.floor((64 - side) / 2) + dx;
  const oy = Math.floor((64 - side) / 2) + dy;
  const wx = Math.min(64, Math.max(0, ox));
  const wy = Math.min(64, Math.max(0, oy));
  const ww = Math.min(64, ox + side) - wx;
  const wh = Math.min(64, oy + side) - wy;
  const identity = ww === 64 && wh === 64 && wx === 0 && wy === 0;
  let count = 0;
  for (let i = 0; i < BAN_MASK.length; i += 1) if (BAN_MASK[i]) count += 1;
  const idx = new Int32Array(count * 5);
  const wts = new Float32Array(count * 4);
  const clampIndex = (value: number, upper: number): number => Math.min(Math.max(value, 0), upper);
  let k = 0;
  if (identity) {
    for (let i = 0; i < BAN_MASK.length; i += 1) {
      if (!BAN_MASK[i]) continue;
      idx[k * 5] = i;
      idx[k * 5 + 1] = i;
      wts[k * 4] = 1;
      k += 1;
    }
  } else {
    const xRatio = ww / 64;
    const yRatio = wh / 64;
    for (let y = 0; y < 64; y += 1) {
      const sy = clampIndex((y + 0.5) * yRatio - 0.5, wh - 1);
      const sy0 = Math.floor(sy);
      const sy1 = Math.min(sy0 + 1, wh - 1);
      const fy = sy - sy0;
      const rowA = (wy + sy0) * 64;
      const rowB = (wy + sy1) * 64;
      for (let x = 0; x < 64; x += 1) {
        const maskIndex = y * 64 + x;
        if (!BAN_MASK[maskIndex]) continue;
        const sx = clampIndex((x + 0.5) * xRatio - 0.5, ww - 1);
        const sx0 = Math.floor(sx);
        const sx1 = Math.min(sx0 + 1, ww - 1);
        const fx = sx - sx0;
        idx[k * 5] = maskIndex;
        idx[k * 5 + 1] = rowA + wx + sx0;
        idx[k * 5 + 2] = rowA + wx + sx1;
        idx[k * 5 + 3] = rowB + wx + sx0;
        idx[k * 5 + 4] = rowB + wx + sx1;
        wts[k * 4] = (1 - fx) * (1 - fy);
        wts[k * 4 + 1] = fx * (1 - fy);
        wts[k * 4 + 2] = (1 - fx) * fy;
        wts[k * 4 + 3] = fx * fy;
        k += 1;
      }
    }
  }
  const plan: BanSamplePlan = { count, idx, wts };
  BAN_SAMPLE_PLANS.set(key, plan);
  return plan;
}

/** Weight of the chrominance (Cb/Cr) NCC term when RGBA is supplied to the ban matcher. */
export const BAN_CHROMA_WEIGHT = 0.35;

/** Tier-2 Pure-TS 8x8 spatial patch Max-Sim thresholds (measured on Draft #1 + #2 corpus when Tier-1 abstains). */
const BAN_PATCH_GRID = 8;
const BAN_PATCH_DIM = 12;
const BAN_PATCH_ZOOMS = [1.0, 1.2, 1.4] as const;
const BAN_PATCH_MIN_SCORE = 0.76;
const BAN_PATCH_MIN_MARGIN = 0.055;
const PICK_PATCH_MIN_SCORE = 0.75;
const PICK_PATCH_MIN_MARGIN = 0.045;

function buildBanPatchGrid(y64: GrayImage, cb64: GrayImage, cr64: GrayImage): Float32Array {
  const ny = normalizeGray(y64);
  const ncb = normalizeGray(cb64);
  const ncr = normalizeGray(cr64);
  const grid = new Float32Array(BAN_PATCH_GRID * BAN_PATCH_GRID * BAN_PATCH_DIM);
  for (let py = 0; py < BAN_PATCH_GRID; py += 1) {
    for (let px = 0; px < BAN_PATCH_GRID; px += 1) {
      const base = (py * BAN_PATCH_GRID + px) * BAN_PATCH_DIM;
      let normSq = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const y0 = py * 8 + sy * 4;
          const x0 = px * 8 + sx * 4;
          let sumY = 0;
          let sumCb = 0;
          let sumCr = 0;
          for (let dy = 0; dy < 4; dy += 1) {
            const row = (y0 + dy) * 64 + x0;
            for (let dx = 0; dx < 4; dx += 1) {
              sumY += ny.data[row + dx];
              sumCb += ncb.data[row + dx];
              sumCr += ncr.data[row + dx];
            }
          }
          const k = sy * 2 + sx;
          const vY = sumY / 16;
          const vCb = sumCb / 16;
          const vCr = sumCr / 16;
          grid[base + k] = vY;
          grid[base + 4 + k] = vCb;
          grid[base + 8 + k] = vCr;
          normSq += vY * vY + vCb * vCb + vCr * vCr;
        }
      }
      const inv = 1 / (Math.sqrt(normSq) + 1e-9);
      for (let d = 0; d < BAN_PATCH_DIM; d += 1) grid[base + d] *= inv;
    }
  }
  return grid;
}

function isPatchCellValid(py: number, px: number, kind: 'ban' | 'pick'): boolean {
  if (kind === 'ban') {
    if ((py === 0 || py === 7) && (px === 0 || px === 7)) return false;
    if (px >= 5 && py >= 4) return false;
    return true;
  }
  return py < 6;
}

function scoreBanPatchMaxSim(qGrid: Float32Array, rGrid: Float32Array, kind: 'ban' | 'pick'): number {
  let total = 0;
  let count = 0;
  for (let py = 0; py < BAN_PATCH_GRID; py += 1) {
    for (let px = 0; px < BAN_PATCH_GRID; px += 1) {
      if (!isPatchCellValid(py, px, kind)) continue;
      const qBase = (py * BAN_PATCH_GRID + px) * BAN_PATCH_DIM;
      let best = -1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ry = py + dy;
        if (ry < 0 || ry >= BAN_PATCH_GRID) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const rx = px + dx;
          if (rx < 0 || rx >= BAN_PATCH_GRID) continue;
          const rBase = (ry * BAN_PATCH_GRID + rx) * BAN_PATCH_DIM;
          let dot = 0;
          for (let d = 0; d < BAN_PATCH_DIM; d += 1) dot += qGrid[qBase + d] * rGrid[rBase + d];
          if (dot > best) best = dot;
        }
      }
      total += best;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * Masked NCC of `prep` against one "ban-style" variant of `full64` using a
 * precomputed `BanSamplePlan` (shared across gray/Cb/Cr planes).
 */
function scoreBanPlane(
  prep: GrayImage,
  prepMoments: PrepMoments,
  plane64: GrayImage,
  plan: BanSamplePlan,
): number {
  if (plan.count < 64) return 0;
  const src = plane64.data;
  const a = prep.data;
  const idx = plan.idx;
  const wts = plan.wts;
  let ab = 0;
  let sb = 0;
  let sbb = 0;
  for (let k = 0; k < plan.count; k += 1) {
    const b5 = k * 5;
    const w4 = k * 4;
    const b = wts[w4] * src[idx[b5 + 1]]
      + wts[w4 + 1] * src[idx[b5 + 2]]
      + wts[w4 + 2] * src[idx[b5 + 3]]
      + wts[w4 + 3] * src[idx[b5 + 4]];
    const out = idx[b5];
    ab += a[out] * b;
    sb += b;
    sbb += b * b;
  }
  const n = plan.count;
  const cov = ab - (prepMoments.sa * sb) / n;
  const va = prepMoments.saa - (prepMoments.sa * prepMoments.sa) / n;
  const vb = sbb - (sb * sb) / n;
  const denom = Math.sqrt(va * vb);
  const value = denom < 1e-9 ? 0 : cov / denom;
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

/** Masked NCC of `prep` against one "ban-style" variant of `full64`. */
function scoreBanVariant(
  prep: GrayImage,
  prepMoments: PrepMoments,
  full64: GrayImage,
  zoom: number,
  dx: number,
  dy: number,
): number {
  return scoreBanPlane(prep, prepMoments, full64, banSamplePlan(zoom, dx, dy));
}

/** Options for HeroMatcher.match; `banPadlock` adds the padlock-avoiding upper-left candidate, `kind` selects per-kind abstention thresholds, and `rgba` enables chroma-assisted ban scoring. */
export interface MatchOptions { banPadlock?: boolean; kind?: 'pick' | 'ban'; rgba?: RgbaPlane }

/**
 * Generate the zoom-search candidate sub-crops, in the EXACT order mirrored by
 * packages/ml-engine/calibrate_vision_regions.py `zoom_candidates` (lockstep):
 * badge-trimmed source at dx (-4, 0, +4), then trimmed centred sub-crops at
 * 0.9/0.8 with dy (0, +6%, -6%), then 0.7 and 0.62 (dy 0), then the full crop.
 */
function zoomCandidates(crop: GrayImage): GrayImage[] {
  const out: GrayImage[] = [];
  const trimH = Math.max(1, Math.floor(crop.height * ZOOM_BADGE_TRIM_RATIO));
  const trimmed = trimH < crop.height
    ? cropGray(crop, { x: 0, y: 0, w: crop.width, h: trimH })
    : crop;
  for (const dx of ZOOM_DX_OFFSETS) {
    out.push(cropGray(trimmed, { x: dx, y: 0, w: trimmed.width, h: trimmed.height }));
  }
  for (const scale of ZOOM_SCALES) {
    const w = Math.max(8, Math.round(trimmed.width * scale));
    const h = Math.max(8, Math.round(trimmed.height * scale));
    for (const dyRatio of (scale >= 0.8 ? ZOOM_DY_RATIOS : [0])) {
      const dy = Math.round(trimmed.height * dyRatio);
      const x = Math.floor((trimmed.width - w) / 2);
      const y = Math.min(Math.max(Math.floor((trimmed.height - h) / 2) + dy, 0), trimmed.height - h);
      out.push(cropGray(trimmed, { x, y, w, h }));
    }
  }
  out.push(crop);
  return out;
}

/** Collapse sorted descending candidates to the highest-scoring entry per `heroId`, so multi-variant references never compete against themselves for margin. */
function dedupeByHeroId(sorted: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<number>();
  const unique: MatchCandidate[] = [];
  for (const candidate of sorted) {
    if (seen.has(candidate.heroId)) continue;
    seen.add(candidate.heroId);
    unique.push(candidate);
  }
  return unique;
}

/** Match slot crops against hero portrait references with dHash shortlisting and NCC scoring. */
export class HeroMatcher {
  private readonly references: readonly ReferenceEntry[];
  private readonly shortlistSize: number;
  private readonly minScore: number;
  private readonly minMargin: number;
  private readonly banMinScore: number;
  private readonly banMinMargin: number;
  private readonly banShortlistSize: number;
  private banPatchCache: Array<{ heroId: number; variants: Float32Array[] }> | null = null;

  constructor(references: ReferenceEntry[], options: HeroMatcherOptions = {}) {
    this.references = [...references];
    this.shortlistSize = Math.max(1, options.shortlistSize ?? DEFAULTS.shortlistSize);
    this.minScore = options.minScore ?? DEFAULTS.minScore;
    this.minMargin = options.minMargin ?? DEFAULTS.minMargin;
    this.banMinScore = options.banMinScore ?? DEFAULTS.banMinScore;
    this.banMinMargin = options.banMinMargin ?? DEFAULTS.banMinMargin;
    this.banShortlistSize = Math.max(1, options.banShortlistSize ?? DEFAULTS.banShortlistSize);
  }

  /** Number of loaded portrait references. */
  get referenceCount(): number {
    return this.references.length;
  }

  /** Number of references that carry the full-resolution portrait the ban path needs. */
  get banReferenceCount(): number {
    return this.references.reduce((total, ref) => (ref.full64 !== undefined ? total + 1 : total), 0);
  }

  /** Match one slot crop against the reference set (zoom candidates -> dHash shortlist -> NCC ranking -> kind-aware thresholded abstention). */
  match(crop: GrayImage, options: MatchOptions = {}): MatchResult {
    if (this.references.length === 0 || crop.width === 0 || crop.height === 0) {
      return { heroId: null, score: 0, abstained: true, candidates: [] };
    }
    // Per-kind abstention: BAN crops use the stricter measured thresholds
    // (DEFAULTS doc — a wrong ban guess is worse than an abstention); a call
    // that only sets the legacy `banPadlock` flag is treated as a ban crop.
    const isBan = (options.kind ?? (options.banPadlock ? 'ban' : 'pick')) === 'ban';
    const minScore = isBan ? this.banMinScore : this.minScore;
    const minMargin = isBan ? this.banMinMargin : this.minMargin;
    if (isBan && this.banReferenceCount > 0) {
      return this.matchBanCrop(crop, minScore, minMargin, options.rgba);
    }
    const baseCandidates = zoomCandidates(crop);
    if (options.banPadlock) {
      // Legacy ban-specific candidate first: the upper-left square avoids the
      // bottom-right padlock overlay. Kept best-of-all-candidates semantics.
      const avoidW = Math.max(8, Math.round(crop.width * BAN_PADLOCK_AVOID_RATIO));
      const avoidH = Math.max(8, Math.round(crop.height * BAN_PADLOCK_AVOID_RATIO));
      baseCandidates.unshift(cropGray(crop, { x: 0, y: 0, w: avoidW, h: avoidH }));
    }
    let best: { heroId: number; score: number; margin: number; candidates: MatchCandidate[] } | null = null;
    for (const candidate of baseCandidates) {
      // Step 1-2: canonical 64x64 preparation + difference hash of the candidate.
      const prepared = normalizeGray(aspectFit(resizeGray(candidate, 64, 64), 64, 64));
      const hash = dHash(prepared);
      // Step 3: shortlist by lowest Hamming distance (per candidate crop).
      const shortlist = this.references
        .map(ref => ({ ref, distance: hammingDistance(hash, ref.hash) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, this.shortlistSize)
        .map(entry => entry.ref);
      // Step 4: NCC score against each shortlisted reference (thumb re-normalized at 64x64).
      const scored: MatchCandidate[] = shortlist.map(ref => ({
        heroId: ref.heroId,
        score: ncc(prepared, normalizeGray(resizeGray(ref.thumb, 64, 64))),
      }));
      // Step 5: rank descending, collapse multi-variant entries per hero, and compute margin against the best distinct hero.
      scored.sort((a, b) => b.score - a.score);
      const unique = dedupeByHeroId(scored);
      const top = unique[0];
      const margin = top.score - (unique[1]?.score ?? 0);
      // Keep the best candidate across the zoom search; ties keep the FIRST
      // (earlier in the documented candidate order) so the result is
      // deterministic and mirrors the Python calibrator.
      if (best === null || top.score > best.score) {
        best = { heroId: top.heroId, score: top.score, margin, candidates: unique.slice(0, 3) };
      }
    }
    // Step 6-8: abstain on low score or thin margin (per-kind thresholds); always report the top-3 of the winning candidate.
    const abstained = best!.score < minScore || best!.margin < minMargin;
    if (abstained) {
      if (options.rgba !== undefined && options.rgba.width > 0 && options.rgba.height > 0) {
        const prepY = normalizeGray(aspectFit(resizeGray(crop, 64, 64), 64, 64));
        const chroma = toCbCr(options.rgba);
        const prepCb = aspectFit(resizeGray(chroma.cb, 64, 64), 64, 64);
        const prepCr = aspectFit(resizeGray(chroma.cr, 64, 64), 64, 64);
        const tier2 = this.matchPatchFallback(prepY, prepCb, prepCr, 'pick');
        if (tier2 !== null) return tier2;
      }
      // Strict horizontal-shift fallback for off-center portraits (e.g. blue-side B3 Erin):
      // requires >= 0.61 NCC, >= 0.12 margin, and chrominance agreement when RGBA is available.
      if (!isBan) {
        const shifted = this.matchShiftedPickFallback(crop, options.rgba);
        if (shifted !== null) return shifted;
      }
    }
    return {
      heroId: abstained ? null : best!.heroId,
      score: best!.score,
      abstained,
      candidates: best!.candidates,
    };
  }

  private matchShiftedPickFallback(crop: GrayImage, rgba?: RgbaPlane): MatchResult | null {
    const trimH = Math.max(1, Math.floor(crop.height * ZOOM_BADGE_TRIM_RATIO));
    const trimmed = trimH < crop.height ? cropGray(crop, { x: 0, y: 0, w: crop.width, h: trimH }) : crop;
    const w = Math.max(8, Math.round(trimmed.width * 0.8));
    const h = Math.max(8, Math.round(trimmed.height * 0.8));
    const centerX = Math.floor((trimmed.width - w) / 2);
    const y = Math.floor((trimmed.height - h) / 2);
    const shiftX = Math.max(4, Math.round(trimmed.width * 0.09));
    const hasRgba = rgba !== undefined && rgba.width === crop.width && rgba.height === crop.height;
    let best: { heroId: number; score: number; margin: number; candidates: MatchCandidate[]; x: number } | null = null;
    for (const x of [Math.max(0, centerX - shiftX), Math.min(trimmed.width - w, centerX + shiftX)]) {
      const prepared = normalizeGray(aspectFit(resizeGray(cropGray(trimmed, { x, y, w, h }), 64, 64), 64, 64));
      const hash = dHash(prepared);
      const shortlist = this.references
        .map(ref => ({ ref, distance: hammingDistance(hash, ref.hash) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, this.shortlistSize)
        .map(entry => entry.ref);
      const scored: MatchCandidate[] = shortlist.map(ref => ({
        heroId: ref.heroId,
        score: ncc(prepared, normalizeGray(resizeGray(ref.thumb, 64, 64))),
      }));
      scored.sort((a, b) => b.score - a.score);
      const unique = dedupeByHeroId(scored);
      const top = unique[0];
      const margin = top.score - (unique[1]?.score ?? 0);
      if (best === null || top.score > best.score) {
        best = { heroId: top.heroId, score: top.score, margin, candidates: unique.slice(0, 3), x };
      }
    }
    if (!best || best.score < 0.61 || best.margin < 0.12) return null;
    if (hasRgba) {
      const ref = this.references.find(r => r.heroId === best!.heroId && r.cb64 !== undefined && r.cr64 !== undefined);
      if (ref?.cb64 && ref?.cr64) {
        const subChroma = toCbCr(cropRgba(rgba!, { x: best.x, y, w, h }));
        const qCb = normalizeGray(resizeGray(subChroma.cb, 64, 64));
        const qCr = normalizeGray(resizeGray(subChroma.cr, 64, 64));
        const chromaAvg = 0.5 * (ncc(qCb, normalizeGray(ref.cb64)) + ncc(qCr, normalizeGray(ref.cr64)));
        if (chromaAvg < 0.30) return null;
      }
    }
    return {
      heroId: best.heroId,
      score: best.score,
      abstained: false,
      candidates: best.candidates,
    };
  }

  /**
   * Ban-specific matcher for a circle-masked 64 px ban icon: masked-NCC coarse
   * ranking over every `full64` reference, a fine zoom/offset variant grid on
   * the shortlist, then the per-kind ban abstention thresholds. The returned
   * `candidates` are the shortlist's top-3 per-hero bests.
   */
  private matchBanCrop(crop: GrayImage, minScore: number, minMargin: number, rgba?: RgbaPlane): MatchResult {
    const prepared = normalizeGray(aspectFit(resizeGray(crop, 64, 64), 64, 64));
    const prepMoments = maskedMoments(prepared);
    const hasRgba = rgba !== undefined && rgba.width > 0 && rgba.height > 0;
    const chroma = hasRgba ? toCbCr(rgba) : null;
    const prepCb = chroma ? aspectFit(resizeGray(chroma.cb, 64, 64), 64, 64) : null;
    const prepCr = chroma ? aspectFit(resizeGray(chroma.cr, 64, 64), 64, 64) : null;
    const cbMoments = prepCb ? maskedMoments(prepCb) : null;
    const crMoments = prepCr ? maskedMoments(prepCr) : null;
    const capable = this.references.filter(ref => ref.full64 !== undefined);
    // Coarse pass: rank the whole capable set with the cheap 2-variant scan.
    const coarse = capable
      .map(ref => {
        let best = -Infinity;
        for (const zoom of BAN_COARSE_ZOOMS) {
          const score = scoreBanVariant(prepared, prepMoments, ref.full64!, zoom, 0, 0);
          if (score > best) best = score;
        }
        return { ref, score: best };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(this.banShortlistSize, capable.length));
    // Fine pass: per-hero best over the full zoom/offset variant grid.
    const perHero: MatchCandidate[] = coarse.map(({ ref }) => {
      let best = -Infinity;
      const useChroma = prepCb !== null && prepCr !== null && cbMoments !== null && crMoments !== null
        && ref.cb64 !== undefined && ref.cr64 !== undefined;
      for (const zoom of BAN_ZOOM_SCALES) {
        for (const dx of BAN_DX_OFFSETS) {
          for (const dy of BAN_DY_OFFSETS) {
            const plan = banSamplePlan(zoom, dx, dy);
            const grayScore = scoreBanPlane(prepared, prepMoments, ref.full64!, plan);
            let score = grayScore;
            if (useChroma) {
              const cbScore = scoreBanPlane(prepCb!, cbMoments!, ref.cb64!, plan);
              const crScore = scoreBanPlane(prepCr!, crMoments!, ref.cr64!, plan);
              score = (1 - BAN_CHROMA_WEIGHT) * grayScore + BAN_CHROMA_WEIGHT * 0.5 * (cbScore + crScore);
            }
            if (score > best) best = score;
          }
        }
      }
      return { heroId: ref.heroId, score: best };
    });
    perHero.sort((a, b) => b.score - a.score);
    const unique = dedupeByHeroId(perHero);
    const top = unique[0];
    const margin = top.score - (unique[1]?.score ?? 0);
    const abstained = top.score < minScore || margin < minMargin;
    if (abstained && prepCb !== null && prepCr !== null) {
      const tier2 = this.matchPatchFallback(prepared, prepCb, prepCr, 'ban');
      if (tier2 !== null) return tier2;
    }
    return {
      heroId: abstained ? null : top.heroId,
      score: top.score,
      abstained,
      candidates: unique.slice(0, 3),
    };
  }

  /**
   * Tier-2 Pure-TS fallback (ColBERT-style 8x8 spatial patch Max-Sim with
   * 3x3 local neighborhood and per-kind occlusion cell masking). Only runs when
   * Tier-1 NCC abstains and RGBA chrominance planes are available.
   */
  private matchPatchFallback(prepY: GrayImage, prepCb: GrayImage, prepCr: GrayImage, kind: 'ban' | 'pick'): MatchResult | null {
    if (this.banPatchCache === null) {
      this.banPatchCache = this.references
        .filter(r => r.full64 !== undefined && r.cb64 !== undefined && r.cr64 !== undefined)
        .map(r => ({
          heroId: r.heroId,
          variants: BAN_PATCH_ZOOMS.map(zoom => {
            const s = Math.max(8, Math.round(64 / zoom));
            const o = Math.floor((64 - s) / 2);
            const rect = { x: o, y: o, w: s, h: s };
            return buildBanPatchGrid(
              resizeGray(cropGray(r.full64!, rect), 64, 64),
              resizeGray(cropGray(r.cb64!, rect), 64, 64),
              resizeGray(cropGray(r.cr64!, rect), 64, 64),
            );
          }),
        }));
    }
    if (this.banPatchCache.length < 2) return null;
    const qGrid = buildBanPatchGrid(prepY, prepCb, prepCr);
    const scored: MatchCandidate[] = this.banPatchCache.map(entry => ({
      heroId: entry.heroId,
      score: Math.max(...entry.variants.map(v => scoreBanPatchMaxSim(qGrid, v, kind))),
    }));
    scored.sort((a, b) => b.score - a.score);
    const unique = dedupeByHeroId(scored);
    const top = unique[0];
    const margin = top.score - (unique[1]?.score ?? 0);
    const minScore = kind === 'ban' ? BAN_PATCH_MIN_SCORE : PICK_PATCH_MIN_SCORE;
    const minMargin = kind === 'ban' ? BAN_PATCH_MIN_MARGIN : PICK_PATCH_MIN_MARGIN;
    if (top.score < minScore || margin < minMargin) return null;
    return {
      heroId: top.heroId,
      score: top.score,
      abstained: false,
      candidates: unique.slice(0, 3),
    };
  }
}
