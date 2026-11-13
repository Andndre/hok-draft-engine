/**
 * Orchestration layer for the live draft advisor: screen capture -> slot
 * recognition -> observation -> recommendation. React-free; communicates with
 * the UI exclusively through callbacks.
 */

import { CaptureSource } from './capture';
import { detectSlotLockBadge } from './badgeLock';
import { cropGray, cropRgba } from './geometry';
import { HeroMatcher } from './heroMatcher';
import { loadReferenceSet } from './referenceSet';
import { resolveSlotSides } from './regionMap';
import { buildManualRegionProfile, type ManualLayoutConfig } from './manualLayout';
import { DraftObserver } from './observer';
import { computeVisionRecommendation } from '../engine/visionAdapter';
import { getDraftSequence } from '../engine/draftRules';
import type { DraftFormat, Hero } from '../types';
import type { CaptureFrame, GrayImage, MatchResult, Rect, SlotObservation, DraftObservation, VisionSide, RegionProfile, SlotRegion, RgbaPlane, SurfaceSlotRect } from './types';
import type { ObserverResult } from './observer';
import type { VisionRecommendation } from '../engine/visionAdapter';

/** Lifecycle/status states the UI can surface to the user. */
export type VisionPipelineStatus =
  | 'idle'
  | 'requesting-permission'
  | 'loading-references'
  | 'running'
  | 'not-calibrated'
  | 'error';

/**
 * Where the active slot layout came from. Production is MANUAL-ONLY: the
 * operator positions the grid on the shared frame and `manualLayout.ts` builds
 * the slot profile from it, so the only live source is 'manual'. 'none' means
 * no grid has been configured yet ("atur kotak slot di panel").
 */
export type LayoutSource = 'manual' | 'none';

/** Per-frame layout report for the advisor panel. */
export interface LayoutStatus {
  /** Where the active layout came from (see LayoutSource). */
  source: LayoutSource;
  /** Frame size the layout applies to. */
  width: number;
  /** Height of the frame. */
  height: number;
  /** Frame timestamp. */
  at: number;
  /** Active manual region profile whose slots drive recognition. Null only when source is 'none'. */
  profile: RegionProfile | null;
  /** The active profile's slot rects in frame pixel coordinates for the panel's overlay; empty for source 'none'. */
  surfaceSlots?: SurfaceSlotRect[];
}

/** Callback surface between VisionPipeline and the React panel. */
export interface VisionPipelineEvents {
  /** Current lifecycle/status state changed. */
  onStatus?: (status: VisionPipelineStatus) => void;
  /**
   * Active slot-layout report changed (source, confidence bucket, or frame
   * size). Emitted once per change, not per frame — `lastLayout` always holds
   * the latest value regardless.
   */
  onLayout?: (layout: LayoutStatus) => void;
  /** Permission prompt closed; `granted` is true when a MediaStream was obtained. */
  onPermission?: (granted: boolean) => void;
  /** Reference-set loading progress (done out of total portraits). */
  onReferenceProgress?: (done: number, total: number) => void;
  /** A new observation was folded by DraftObserver. */
  onObservation?: (observation: DraftObservation, result: ObserverResult) => void;
  /** A new recommendation was computed for the user's declared side. */
  onRecommendation?: (recommendation: VisionRecommendation) => void;
  /**
   * Colour cross-check between the detected left-column tint and the
   * operator's declared side. Emitted only when the detection is CONFIDENT
   * ('red' or 'blue'), never for 'unknown'. The operator's manual choice
   * always stays authoritative — the panel should render `mismatch === true`
   * as a warning (e.g. "UI menunjukkan sisi biru, tetapi kamu memilih merah")
   * WITHOUT switching sides.
   */
  onSideCheck?: (check: SideCrossCheck) => void;
  /** A non-fatal error occurred (permission denied, track ended, etc.). */
  onError?: (message: string) => void;
}

/** Configuration for VisionPipeline; all mutable fields have setters. */
export interface VisionPipelineOptions {
  heroes: Hero[];
  side: VisionSide;
  format?: DraftFormat;
  onlyGlobal?: boolean;
  fearless?: { blue: number[]; red: number[] };
  planAId?: number | null;
  planBId?: number | null;
  isUltimateBattle?: boolean;
  synergyDb?: Record<string, any>;
  fps?: number;
  maxWidth?: number;
  /** Optional manual grid layout. This is the ONLY geometry source in production; without it the pipeline reports 'not-calibrated'. */
  manualLayout?: ManualLayoutConfig | null;
}

/**
 * Scale an axis-aligned rectangle from one coordinate system to another using
 * independent width/height ratios. Used to map device-native slot rects from a
 * RegionProfile onto the actual captured frame size.
 */
export function scaleRect(rect: Rect, fromW: number, fromH: number, toW: number, toH: number): Rect {
  if (fromW <= 0 || fromH <= 0 || toW <= 0 || toH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return {
    x: rect.x * (toW / fromW),
    y: rect.y * (toH / fromH),
    w: rect.w * (toW / fromW),
    h: rect.h * (toH / fromH),
  };
}

/**
 * Standard-deviation threshold (on the 0..255 grayscale scale) separating an
 * EMPTY Ban&Pick slot from an OCCUPIED one. Measured on the real corpus
 * (data/vision-corpus, both ranked drafts, frames 028–042 + 222–229 empty /
 * 065–078 + 250–256 filled, Pillow decoded with the TS Rec.601 rounding):
 *
 * - EMPTY pick placeholders (tinted box + grey helmet glyph, including the
 *   highlighted "your turn" variant): std 8.3–26.8 — far ABOVE the old 4.0,
 *   which misread every empty slot as occupied and broke the advisor from the
 *   first frame of the ban phase.
 * - OCCUPIED pick crops: pre-selection hints ("Pilih Dulu", portrait under a
 *   dim overlay) std 31.0–42.1; committed/locked portraits std 35.0–68.4.
 * - EMPTY ban circles (incl. the dim role-icon placeholder a skipped ban
 *   leaves behind): std 5.5–13.7; FILLED ban circles: std 42.9–76.1.
 *
 * The measured clusters do not overlap (empty max 26.8, occupied min 31.0);
 * 30.0 sits between with a 3.2 margin above the empty cluster and 4.0 below
 * the occupied one, and works for both slot kinds. The std test stays ONLY
 * the empty-vs-filled discriminator; the LOCK state is decided by the
 * chevron/badge detector (badgeLock.ts), not by variance.
 */
export const BLANK_SLOT_STD_THRESHOLD = 30.0;

/** Compute population standard deviation of a grayscale crop (0..255 scale). */
function cropStd(crop: GrayImage): number {
  const n = crop.width * crop.height;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += crop.data[i];
  const mean = sum / n;
  let squared = 0;
  for (let i = 0; i < n; i += 1) {
    const d = crop.data[i] - mean;
    squared += d * d;
  }
  return Math.sqrt(squared / n);
}

/**
 * Return true when a slot crop has so little contrast that it is almost
 * certainly an empty Ban&Pick slot, not a portrait that failed to match.
 */
export function isBlankSlot(crop: GrayImage): boolean {
  return cropStd(crop) < BLANK_SLOT_STD_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Chronological slot ordering
// ---------------------------------------------------------------------------

/**
 * Sort one observation's slots into the CHRONOLOGICAL order the observer's
 * contract requires, within each (side, kind) group.
 *
 * `firstFilledAt` maps a slot's `SlotRegion.index` to the first frame
 * timestamp at which that slot became occupied (blank -> non-blank
 * transition). `firstLockedAt` (optional) maps pick-slot indexes to the first
 * timestamp at which the lock badge was latched; LOCKED pick slots sort by
 * lock time and always come BEFORE unlocked-occupied ones of the same group
 * (on the ranked board locks are prefix-ordered, so the observer's replay
 * consumes every committed pick before it stops on a pre-selection).
 * Slots that are occupied (identified, or occupied-but-unidentified i.e.
 * `abstained`) sort ascending by that timestamp — a slot that filled
 * later ranks AFTER a slot that was already filled, and the group's order can
 * therefore change between observations, which is expected and correct: the
 * observer rebuilds the position from scratch on every ingest, so a reorder
 * simply produces the corrected position. Still-empty slots follow at the end
 * of their group (stable, by array order). Groups keep the relative position
 * they first appeared at in the input array, and one SlotObservation per
 * region slot is always preserved.
 */
export function sortSlotsChronologically(
  slots: SlotObservation[],
  firstFilledAt: Map<number, number>,
  firstLockedAt?: Map<number, number>,
): SlotObservation[] {
  const groups = new Map<string, SlotObservation[]>();
  const groupOrder: string[] = [];
  for (const slot of slots) {
    const key = `${slot.side}:${slot.kind}`;
    const queue = groups.get(key);
    if (queue) queue.push(slot);
    else {
      groups.set(key, [slot]);
      groupOrder.push(key);
    }
  }
  const out: SlotObservation[] = [];
  for (const key of groupOrder) {
    const group = groups.get(key)!;
    const occupied = group.filter(slot => slot.heroId !== null || slot.abstained);
    const locked = occupied.filter(slot => slot.locked === true);
    const unlocked = occupied.filter(slot => slot.locked !== true);
    const byFill = (a: SlotObservation, b: SlotObservation): number =>
      (firstFilledAt.get(a.index) ?? Number.POSITIVE_INFINITY) - (firstFilledAt.get(b.index) ?? Number.POSITIVE_INFINITY)
      || a.index - b.index;
    locked.sort((a, b) =>
      (firstLockedAt?.get(a.index) ?? firstFilledAt.get(a.index) ?? Number.POSITIVE_INFINITY)
      - (firstLockedAt?.get(b.index) ?? firstFilledAt.get(b.index) ?? Number.POSITIVE_INFINITY)
      || a.index - b.index);
    unlocked.sort(byFill);
    const empty = group.filter(slot => slot.heroId === null && !slot.abstained);
    out.push(...locked, ...unlocked, ...empty);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colour-side detection (team tint of the own-team column)
// ---------------------------------------------------------------------------

/** Minimum interval between automatic colour-side cross-checks (the tint is static between sessions). */
export const COLOUR_CHECK_INTERVAL_MS = 500;

/** Pure scheduling rule for the automatic colour cross-check: run on the first frame and then at most once per `intervalMs`. */
export function shouldRunColourCheck(lastCheckAt: number | null, ts: number, intervalMs: number = COLOUR_CHECK_INTERVAL_MS): boolean {
  return lastCheckAt === null || ts - lastCheckAt >= intervalMs;
}

// (RgbaPlane/CaptureFrame types are imported from types.ts and re-exported at
// the bottom of this module for backwards compatibility.)

/**
 * Decide the tint of the LEFT (own-team) column from raw colour pixels.
 *
 * The team tint is dim — red placeholder tiles measure ~(63,23,33) RGB, blue
 * ~(9,36,66) — so classification is HUE-based, not intensity-gated: among
 * pixels with chroma >= 16, warm = r >= g+12 && r >= b+12, cool =
 * b >= g+12 && b >= r+12 (mirrors badge/tile measurements from
 * packages/ml-engine/calibrate_vision_regions.py). `rects` should cover the
 * own-team column's pick-slot tiles (pass the union rects of the profile's
 * own-side slots; the dark-navy scene background reads cool and must not
 * dominate, so prefer tile rects over a whole-column band).
 *
 * Returns 'red' | 'blue' when one hue dominates >= 1.5:1 among enough
 * chromatic pixels, else 'unknown'. NEVER overrides the operator: the result
 * is a cross-check signal only.
 */
export function detectLeftColumnSide(rgba: RgbaPlane, rects: Rect[]): 'red' | 'blue' | 'unknown' {
  let warm = 0;
  let cool = 0;
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(rgba.width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(rgba.height, Math.ceil(rect.y + rect.h));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = (y * rgba.width + x) * 4;
        const r = rgba.data[p];
        const g = rgba.data[p + 1];
        const b = rgba.data[p + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 16) continue;
        if (r >= g + 12 && r >= b + 12) warm += 1;
        else if (b >= g + 12 && b >= r + 12) cool += 1;
      }
    }
  }
  if (warm + cool < 50) return 'unknown';
  if (warm > cool * 1.5) return 'red';
  if (cool > warm * 1.5) return 'blue';
  return 'unknown';
}

/** Result of the colour cross-check between the detected column tint and the operator's declared side. */
export interface SideCrossCheck {
  /** Tint detected from the frame's own-team (left) column pixels. */
  detected: 'red' | 'blue' | 'unknown';
  /** The operator's manually declared side (always authoritative). */
  declared: VisionSide;
  /** True only when the detection is confident AND disagrees with the declaration. */
  mismatch: boolean;
  /** Frame timestamp of the check. */
  checkedAt: number;
}

/** Pure mismatch rule for a side cross-check, kept testable without pixels. */
export function sideCrossCheck(detected: 'red' | 'blue' | 'unknown', declared: VisionSide, checkedAt: number): SideCrossCheck {
  const mismatch = detected !== 'unknown' && detected !== declared;
  return { detected, declared, mismatch, checkedAt };
}

// ---------------------------------------------------------------------------
/** Module-level cache so re-mounting the panel does not re-fetch 137 portraits. */
let referenceCache: Promise<import('./types').ReferenceEntry[]> | null = null;

/**
 * Drives capture -> recognition -> observation -> recommendation. Holds the
 * CaptureSource and HeroMatcher lifecycle and emits callbacks for the UI.
 */
export class VisionPipeline {
  private readonly capture: CaptureSource;
  private readonly events: VisionPipelineEvents;
  private readonly options: Required<Pick<VisionPipelineOptions, 'format' | 'onlyGlobal' | 'isUltimateBattle'>> &
    Omit<VisionPipelineOptions, 'format' | 'onlyGlobal' | 'isUltimateBattle'>;  private statusValue: VisionPipelineStatus = 'idle';
  private matcher: HeroMatcher | null = null;
  private observer: DraftObserver | null = null;
  private frameCount = 0;
  /** First fill timestamp per slot index (SlotRegion.index), across frames. */
  private firstFilledAt = new Map<number, number>();
  /** First lock-badge timestamp per pick-slot index (authoritative chronological signal). */
  private firstLockedAt = new Map<number, number>();
  /** Latched lock state per slot index: a lock badge can flicker for a frame, a lock never un-locks. */
  private lockedSlots = new Set<number>();
  /** Timestamp of the last automatic colour-side cross-check (interval-gated). */
  private lastColourCheckAt: number | null = null;
  private lastSideCheckValue: SideCrossCheck | null = null;
  private lastProfileVersion: string | null = null;
  /** Last resolution-mismatch message emitted; deduplicates per-frame reporting. */
  private lastResolutionIssue: string | null = null;
  /** Last LayoutStatus emitted through onLayout (change-detection key). */
  private lastLayoutStatus: LayoutStatus | null = null;
  /** Key of the last emitted layout report. */
  private lastLayoutKey: string | null = null;
  /** Most recently processed frame, exposed for the preview overlay. */
  private lastFrameValue: { rgba: Uint8ClampedArray; gray: GrayImage; width: number; height: number; ts: number } | null = null;
  /** Per-slot matcher memoisation (see SlotMatchCache). */
  private readonly matchCache = new SlotMatchCache();
  private lastMatchCacheGeometryKey: string | null = null;

  constructor(options: VisionPipelineOptions, events: VisionPipelineEvents = {}) {
    // maxWidth keeps the shared screen at (at most) the calibrated profile
    // width: resolveRegionProfileTolerant matches any capture with the
    // calibrated board's aspect ratio (exact size first), so a smaller scrcpy
    // window still resolves the layout and slot rects are scaled onto it.
    this.capture = new CaptureSource({ fps: options.fps ?? 3, maxWidth: options.maxWidth ?? 2800 });
    this.events = events;
    this.options = {
      ...options,
      format: options.format ?? 'tournament',
      onlyGlobal: options.onlyGlobal ?? true,
      isUltimateBattle: options.isUltimateBattle ?? false,
    };
    this.capture.onFrame(frame => this.handleFrame(frame));
  }

  /** Current lifecycle/status state. */
  get status(): VisionPipelineStatus {
    return this.statusValue;
  }

  /** True when the browser environment supports screen capture. */
  static isSupported(): boolean {
    return CaptureSource.isSupported();
  }

  /** Request screen share, load references lazily, and begin processing frames. */
  async start(): Promise<void> {
    if (this.statusValue === 'running' || this.statusValue === 'requesting-permission') return;
    // A (re)start is a new capture session: cached slot matches from the old
    // surface must never leak into it.
    this.matchCache.clear();
    this.lastMatchCacheGeometryKey = null;
    this.setStatus('requesting-permission');
    await this.capture.start();
    if (this.capture.status === 'error') {
      const error = this.capture.lastError ?? 'Gagal memulai tangkapan layar.';
      this.setStatus('error');
      this.events.onError?.(error);
      this.events.onPermission?.(false);
      return;
    }
    this.events.onPermission?.(true);
    await this.ensureMatcher();
    if (this.statusValue === 'error') return;
    this.setStatus('running');
  }

  /** Stop capture and release the media track. */
  stop(): void {
    this.capture.stop();
    this.frameCount = 0;
    this.firstFilledAt.clear();
    this.firstLockedAt.clear();
    this.lockedSlots.clear();
    this.lastColourCheckAt = null;
    this.lastProfileVersion = null;
    this.lastResolutionIssue = null;
    this.lastLayoutStatus = null;
    this.lastLayoutKey = null;
    this.lastFrameValue = null;
    this.matchCache.clear();
    this.lastMatchCacheGeometryKey = null;
    if (this.statusValue !== 'error') {
      this.setStatus('idle');
    }
  }

  /**
   * Run the colour-side cross-check against an RGBA frame the CALLER supplies
   * (the pipeline's own capture path is grayscale-only; a panel or harness
   * that has colour pixels can call this alongside the normal flow — see the
   * lane report for the exact wiring). Uses the active profile's own-side
   * (left column) pick-slot tile rects, scaled to the supplied buffer size.
   * The operator's declared side is never changed by this; the result is a
   * warning signal only (`onSideCheck` / `lastSideCheck`).
   */
  inspectColourFrame(rgba: RgbaPlane, ts: number = Date.now(), activeProfile?: RegionProfile): SideCrossCheck | null {
    const plane = rgba;
    const profile = activeProfile ?? (this.options.manualLayout ? buildManualRegionProfile(this.options.manualLayout, plane.width, plane.height) : null);
    if (!profile || profile.slots.length === 0) return null;
    const ownSide: VisionSide = profile.ownSide ?? 'red';
    const ownSlots = profile.slots.filter(slot => slot.side === ownSide && slot.kind === 'pick');
    if (ownSlots.length === 0) return null;
    const rects: Rect[] = ownSlots.map(slot => {
      const scaled = scaleRect(slot.rect, profile.resolution.width, profile.resolution.height, plane.width, plane.height);
      return { x: scaled.x, y: scaled.y, w: scaled.w, h: scaled.h * 0.8 };
    });
    const detected = detectLeftColumnSide(plane, rects);
    if (detected === 'unknown') return null;
    const check = sideCrossCheck(detected, this.options.side, ts);
    this.lastSideCheckValue = check;
    this.events.onSideCheck?.(check);
    return check;
  }

  /** Most recent colour cross-check, or null when none was confident yet. */
  get lastSideCheck(): SideCrossCheck | null {
    return this.lastSideCheckValue;
  }

  /** Most recent layout report (source + confidence), or null before the first frame. */
  get lastLayout(): LayoutStatus | null {
    return this.lastLayoutStatus;
  }

  /** Matcher calls the per-slot cache served this session (diagnostic: a hit is one avoided match). */
  get matchCacheHitCount(): number {
    return this.matchCache.hitCount;
  }

  /** Matcher calls the per-slot cache could not serve this session (diagnostic: each led to a re-match). */
  get matchCacheMissCount(): number {
    return this.matchCache.missCount;
  }

  /** Number of slots currently holding a cached matcher verdict. */
  get matchCacheSize(): number {
    return this.matchCache.size;
  }

  /**
   * Most recently processed frame (RGBA + grayscale) in FULL surface
   * coordinates — never the content-cropped view, so the preview overlay and
   * `surfaceSlots` share one coordinate space. Null before the first frame;
   * the caller must not mutate the returned buffers.
   */
  getLastFrame(): { rgba: Uint8ClampedArray; gray: GrayImage; width: number; height: number; ts: number } | null {
    return this.lastFrameValue;
  }

  /** Change the user's declared side; resets the observer so the next frame rebuilds. */
  setSide(side: VisionSide): void {
    if (this.options.side === side) return;
    this.options.side = side;
    this.rebuildObserver();
  }

  /** Update the manual grid layout (null returns to automatic detection) and refresh the active frame. */
  setManualLayout(config: ManualLayoutConfig | null): void {
    this.options.manualLayout = config;
    this.matchCache.clear();
    this.lastLayoutKey = null;
    if (this.lastFrameValue && (this.statusValue === 'running' || this.statusValue === 'not-calibrated')) {
      this.handleFrame(this.lastFrameValue);
    }
  }

  /** Update the hero catalog (e.g. after Global filter changes); also resets the observer. */
  setHeroes(heroes: Hero[]): void {
    if (this.options.heroes === heroes) return;
    this.options.heroes = heroes;
    this.rebuildObserver();
  }

  /** Update draft format. */
  setFormat(format: DraftFormat): void {
    if (this.options.format === format) return;
    this.options.format = format;
    this.rebuildObserver();
  }

  /** Update Fearless locks. */
  setFearless(fearless: { blue: number[]; red: number[] }): void {
    this.options.fearless = { blue: [...fearless.blue], red: [...fearless.red] };
    this.rebuildObserver();
  }

  /** Update Plan A opener. */
  setPlanA(planAId: number | null): void {
    if (this.options.planAId === planAId) return;
    this.options.planAId = planAId;
  }

  /** Update Plan B opener. */
  setPlanB(planBId: number | null): void {
    if (this.options.planBId === planBId) return;
    this.options.planBId = planBId;
  }

  /** Update the Global-release filter (observer legality only; matcher already covers all heroes). */
  setOnlyGlobal(onlyGlobal: boolean): void {
    if (this.options.onlyGlobal === onlyGlobal) return;
    this.options.onlyGlobal = onlyGlobal;
    this.rebuildObserver();
  }

  /** Update Ultimate Battle flag. */
  setUltimateBattle(isUltimateBattle: boolean): void {
    if (this.options.isUltimateBattle === isUltimateBattle) return;
    this.options.isUltimateBattle = isUltimateBattle;
    this.rebuildObserver();
  }

  private rebuildObserver(): void {
    this.observer = this.createObserver();
  }

  private createObserver(): DraftObserver {
    return new DraftObserver({
      heroes: this.options.heroes,
      side: this.options.side,
      format: this.options.format,
      onlyGlobal: this.options.onlyGlobal,
      fearless: this.options.fearless,
      isUltimateBattle: this.options.isUltimateBattle,
      slotOrder: 'chronological',
    });
  }

  private async ensureMatcher(): Promise<void> {
    if (this.matcher) return;
    if (this.options.heroes.length === 0) return;
    this.setStatus('loading-references');
    try {
      const sources = this.options.heroes.filter(hero => hero.hero_id !== 511);
      if (sources.length === 0) throw new Error('Tidak ada hero yang tersedia untuk referensi pengenalan.');
      if (!referenceCache) {
        referenceCache = loadReferenceSet(sources, {
          onProgress: (done, total) => this.events.onReferenceProgress?.(done, total),
        });
      }
      const references = await referenceCache;
      this.matcher = new HeroMatcher(references);
      if (this.matcher.referenceCount === 0) throw new Error('Gagal memuat referensi hero.');
    } catch (err) {
      this.setStatus('error');
      this.events.onError?.(err instanceof Error ? err.message : 'Gagal memuat referensi hero.');
      referenceCache = null;
    }
  }

  private setStatus(next: VisionPipelineStatus): void {
    if (this.statusValue === next) return;
    this.statusValue = next;
    this.events.onStatus?.(next);
  }

  /**
   * Report (once per distinct cause) why no profile is active for a frame.
   *
   * The status stays the existing 'not-calibrated' for both failure modes,
   * but the emitted onError message distinguishes them: a capture whose
   * aspect ratio matches no calibrated layout (wrong window shared, or a
   * letterboxed device image inside the captured surface) is called out with
   * the concrete frame size, while an exact hit on a slot-less placeholder
   * profile reports that the layout exists but was never calibrated.
   */
  private reportResolutionIssue(width: number, height: number): void {
    const issue = `Tata letak manual belum aktif. Atur kotak slot di panel agar hero bisa dikenali.`;
    if (this.lastResolutionIssue === issue) return;
    this.lastResolutionIssue = issue;
    this.events.onError?.(issue);
  }

  /**
   * Emit a LayoutStatus through onLayout when it materially changed (source,
   * frame size). `surfaceSlots` are derived from the active profile.
   */
  private emitLayout(status: LayoutStatus): LayoutStatus {
    const enriched: LayoutStatus = {
      ...status,
      surfaceSlots: this.surfaceSlotsFor(status.profile, status.width, status.height),
    };
    this.lastLayoutStatus = enriched;
    const key = `${enriched.source}:${enriched.width}x${enriched.height}`;
    if (key !== this.lastLayoutKey) {
      this.lastLayoutKey = key;
      this.events.onLayout?.(enriched);
    }
    return enriched;
  }

  /**
   * Content-rect detection for one captured surface, cached per surface size
   * AND self-invalidating against the current frame: a zoom/pan of the shared
   * image changes the content INSIDE an unchanged surface size, so the size
   * alone is not a sufficient cache key. Three invalidation triggers for a
   * cached verdict:
   * - the dimensions change (as before);
   * - the caller's cheap screen-off probe flagged the frame as a darkness
   *   candidate (`mayBeDark` — a screen going dark at an unchanged size must
   *   re-open the verdict), or the cached verdict was "no content" (a lit
   *   frame returning at the same size must be noticed) — as before;
   * - NEW: the cached verdict was DETECTED (bars or aspect search) and the
   *   frame no longer matches it. Validation is cheap: the border-energy
   *   probe (`measureContentRectBorders` + `contentRectBordersStale`) re-reads
   *   the cached rect's four boundary lines in the current frame — the same
   *   gradient quantity the aspect search justifies its edges with — and
   *   declares the verdict stale when any border's energy collapsed (the real
   *   boundary moved) or more than doubled. O(2*(w+h)) pixel reads
   *   (~5.5k on the 1901x982 photo surface), versus the O(W*H) re-detection
   *   it avoids. A belt-and-braces forced re-detection at most every
   *   CONTENT_RECT_REDETECT_INTERVAL_MS covers whatever the border check
   *   misses; on a static frame the re-detection is deterministic, so the
   *   published layout cannot thrash. Whole-surface verdicts (the scrcpy
   *   path) are served exactly as before with NO validation cost: the
   *   surface IS the content, there is no cached boundary to go stale.
   *   `computeGray` stays lazy for the re-detection path; `validateGray` (the
   *   current frame's gray, when the caller has it without an extra
   *   conversion) enables the border probe on cache hits — without it only
   *   the periodic re-detection applies.
   *
   * Second stage: when the band scan returns the WHOLE surface AND that
   * surface's aspect matches no calibrated profile, an aspect-constrained
   * search (`aspectSearchContentRect`) looks for the device image INSIDE
   * textured chrome (e.g. a Photos window showing the game at ~68% zoom). The
   * scrcpy path — the surface IS the content — resolves a calibrated profile
   * by aspect and never pays for the search; the solver path stays the
   * fallback when the search finds nothing with sufficient evidence.
   */
  private surfaceSlotsFor(profile: RegionProfile | null, width: number, height: number): SurfaceSlotRect[] {
    if (!profile || profile.slots.length === 0) return [];
    return resolveSlotSides(profile, this.options.side).map(slot => {
      const scaled = scaleRect(slot.rect, profile.resolution.width, profile.resolution.height, width, height);
      return {
        index: slot.index,
        side: slot.side,
        kind: slot.kind,
        rect: { x: scaled.x, y: scaled.y, w: scaled.w, h: scaled.h },
      };
    });
  }

  private resolveActiveLayout(frame: { gray: GrayImage; width: number; height: number; ts: number; rgba?: Uint8ClampedArray | Uint8Array }): { profile: RegionProfile; status: LayoutStatus } | null {
    if (this.options.manualLayout) {
      const profile = buildManualRegionProfile(this.options.manualLayout, frame.width, frame.height);
      const status: LayoutStatus = {
        source: 'manual',
        width: frame.width,
        height: frame.height,
        at: frame.ts,
        profile,
      };
      return {
        profile,
        status: this.emitLayout(status),
      };
    }
    this.emitLayout({ source: 'none', width: frame.width, height: frame.height, at: frame.ts, profile: null });
    return null;
  }

  private handleFrame(frame: { gray: GrayImage; width: number; height: number; ts: number; rgba?: Uint8ClampedArray | Uint8Array }): void {
    if (this.capture.status !== 'running') return;
    this.frameCount += 1;
    if (frame.rgba) {
      this.lastFrameValue = {
        rgba: frame.rgba as Uint8ClampedArray,
        gray: frame.gray,
        width: frame.width,
        height: frame.height,
        ts: frame.ts,
      };
    }
    if (!this.matcher || !this.observer) {
      this.ensureMatcher().catch(() => {});
      return;
    }

    const layout = this.resolveActiveLayout(frame);
    if (!layout) {
      this.reportResolutionIssue(frame.width, frame.height);
      if (this.statusValue !== 'not-calibrated') {
        this.setStatus('not-calibrated');
      }
      return;
    }
    const profile = layout.profile;
    this.lastResolutionIssue = null;

    if (this.statusValue === 'not-calibrated') {
      this.setStatus('running');
    }
    if (profile.version !== this.lastProfileVersion) {
      // A different profile means different slot identities — first-fill
      // history from the old layout must not leak into the new one. The same
      // applies to cached slot matches: an entry keyed by index was computed
      // for the OLD profile's geometry/content.
      this.firstFilledAt.clear();
      this.firstLockedAt.clear();
      this.lockedSlots.clear();
      this.matchCache.clear();
      this.lastProfileVersion = profile.version;
    }

    // Slot sides are resolved by MIRRORING against the operator's declared
    // side (profile sides describe the captured session); geometry is
    // unaffected. The declaration stays authoritative — the colour cue is
    // only a cross-check signal (`inspectColourFrame` / `onSideCheck`).
    const regions: SlotRegion[] = resolveSlotSides(profile, this.options.side);
    const slots = buildSlotObservations(frame, profile, this.matcher, regions, this.lockedSlots, this.matchCache);

    for (const slot of slots) {
      if ((slot.heroId !== null || slot.abstained) && !this.firstFilledAt.has(slot.index)) {
        this.firstFilledAt.set(slot.index, frame.ts);
      }
      if (slot.locked === true && !this.lockedSlots.has(slot.index)) {
        // Latch the lock badge so a one-frame badge flicker cannot un-lock a
        // committed pick; the lock timestamp is the primary chronological
        // signal (mirrors the calibrator's badge-lock ordering).
        this.lockedSlots.add(slot.index);
        if (!this.firstLockedAt.has(slot.index)) this.firstLockedAt.set(slot.index, frame.ts);
      }
    }
    const sortedSlots = sortSlotsChronologically(slots, this.firstFilledAt, this.firstLockedAt);

    // Automatic colour-side cross-check (interval-gated: the column tint is
    // static for a whole session). The FULL surface RGBA plane is handed over
    // — inspectColourFrame applies the same content crop itself so the colour
    // check and the recognition agree about coordinates. Emits `onSideCheck`
    // only when confident; the declared side is never changed by it.
    if (frame.rgba && shouldRunColourCheck(this.lastColourCheckAt, frame.ts)) {
      this.lastColourCheckAt = frame.ts;
      this.inspectColourFrame({ data: frame.rgba, width: frame.width, height: frame.height }, frame.ts, profile);
    }

    const observation: DraftObservation = {
      ts: frame.ts,
      screen: 'draft',
      slots: sortedSlots,
      side: this.options.side,
    };

    const result = this.observer.ingest(observation);
    this.events.onObservation?.(observation, result);

    if (result.changed || this.frameCount <= 1) {
      const recommendation = computeVisionRecommendation({
        position: result.position,
        heroes: this.options.heroes,
        side: this.options.side,
        format: this.options.format,
        isUltimateBattle: this.options.isUltimateBattle,
        synergyDb: this.options.synergyDb,
        planAId: this.options.planAId,
        planBId: this.options.planBId,
        onlyGlobal: this.options.onlyGlobal,
        fearless: this.options.fearless,
      });
      this.events.onRecommendation?.(recommendation);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-slot match cache (static-slot memoisation)
// ---------------------------------------------------------------------------

/** Side length of the coarse block-mean grid that forms a slot crop's cache signature. */
export const SLOT_CACHE_SIGNATURE_GRID = 8;

/**
 * Maximum per-cell delta (0..255 grayscale scale) for two crop signatures to
 * count as the same content and serve a cached matcher verdict.
 *
 * WHY THIS IS CHEAP AND SOUND (signature choice): each cell is the MEAN of a
 * rectangular block of the crop (not a point sample, so H.264 quantization
 * noise averages out within a cell; scrcpy's default 8 Mbps stream deviates
 * at worst ~0.9% of 255 ≈ 2.3 per PIXEL, i.e. well under 1 per block mean of
 * the >= 64 pixels a ban cell aggregates), while a CHANGED icon (ban fill,
 * portrait swap, lock) is a full-art replacement that moves many cells by
 * tens of levels. Computing it is one O(crop-pixel) pass — ~21k adds for a
 * 147px pick tile, ~4k for a 64px ban icon — versus ~130 ms (pick) / ~150 ms
 * (6 bans) of NCC matching. 1.0 keeps >= 2x head-room over the per-cell
 * compression-noise estimate so static slots never thrash, while any real
 * art change (measured tens of levels) invalidates immediately.
 *
 * ACCEPTED COLLISION RISK: a stale verdict is served only if two DIFFERENT
 * crops have every one of their 64 block means within 1/255 of each other.
 * Measured on the real corpus (41 draft frames x 16 slots, tolerance 1.0):
 * every real content change (ban fill, ban swap, pick fill/lock) moves block
 * means by tens of levels, while the only sub-threshold movement is the
 * board's own shimmer (<= 0.72 per cell per frame) — serving across it
 * flipped NO identity, NO abstention and NO estimated/locked flag in 446
 * verdicts, and drifted the reported NCC score by at most ~0.004 (a
 * sub-pixel-display confidence wobble the fresh-match path itself exhibits
 * frame-to-frame). The failure direction is bounded: ban identities are soft
 * `estimated` signals that never enter the draft position, and cached pick
 * verdicts are only ever stored while the slot is LOCKED (committed portraits
 * are static for the rest of the session, changing at most once, with a large
 * fill change — the same static-strip argument as the ban strip).
 */
export const SLOT_CACHE_SIGNATURE_TOLERANCE = 1.0;

/**
 * 8x8 block-mean signature of a slot crop (0..255 per cell), or null when the
 * crop is smaller than the grid — caching is then disabled for that slot and
 * the caller always re-matches.
 */
export function slotCropSignature(crop: GrayImage): Float32Array | null {
  const grid = SLOT_CACHE_SIGNATURE_GRID;
  if (crop.width < grid || crop.height < grid) return null;
  const cells = new Float32Array(grid * grid);
  for (let cy = 0; cy < grid; cy += 1) {
    const y0 = Math.floor((cy * crop.height) / grid);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * crop.height) / grid));
    for (let cx = 0; cx < grid; cx += 1) {
      const x0 = Math.floor((cx * crop.width) / grid);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * crop.width) / grid));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        const row = y * crop.width;
        for (let x = x0; x < x1; x += 1) {
          sum += crop.data[row + x];
          count += 1;
        }
      }
      cells[cy * grid + cx] = sum / count;
    }
  }
  return cells;
}

/** True when every cell of two block-mean signatures is within `tolerance` (same-content verdict). */
export function slotSignaturesMatch(a: Float32Array, b: Float32Array, tolerance: number = SLOT_CACHE_SIGNATURE_TOLERANCE): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

/** One cached matcher verdict together with the signature, geometry and slot identity it was computed for. */
interface SlotMatchCacheEntry {
  kind: SlotRegion['kind'];
  side: SlotRegion['side'];
  /** Frame-space scaled slot rect the crop came from (a shifted crop must not reuse the verdict). */
  rect: Rect;
  width: number;
  height: number;
  signature: Float32Array;
  result: MatchResult;
}

/**
 * Per-slot matcher memoisation for the live pipeline, keyed by slot identity
 * (`SlotRegion.index`, stable across frames). A cached verdict is served only
 * when the slot's kind/side, its exact frame-space rect, the crop dimensions
 * AND the crop's coarse block-mean signature all match the stored entry —
 * i.e. only for a content- AND geometry-unchanged crop. The matcher is
 * deterministic on its crop input, so serving the stored verdict for an
 * unchanged crop is result-identical to re-matching; `clear()` must be called
 * when the capture restarts, when the region profile changes, or when the
 * content rect changes (the pipeline owns all three triggers).
 */
export class SlotMatchCache {
  private entries = new Map<number, SlotMatchCacheEntry>();
  private hitCountValue = 0;
  private missCountValue = 0;

  /**
   * Cached verdict for `region` when its crop's signature and geometry match
   * the stored entry; null (and a counted miss) otherwise. Never mutates the
   * entry on a mismatch — the caller re-matches and `put`s the fresh result.
   */
  get(region: SlotRegion, rect: Rect, crop: GrayImage): MatchResult | null {
    const entry = this.entries.get(region.index);
    if (!entry) {
      this.missCountValue += 1;
      return null;
    }
    const signature = slotCropSignature(crop);
    if (!signature
      || entry.kind !== region.kind
      || entry.side !== region.side
      || entry.rect.x !== rect.x || entry.rect.y !== rect.y
      || entry.rect.w !== rect.w || entry.rect.h !== rect.h
      || entry.width !== crop.width || entry.height !== crop.height
      || !slotSignaturesMatch(entry.signature, signature)) {
      this.missCountValue += 1;
      return null;
    }
    this.hitCountValue += 1;
    return entry.result;
  }

  /** Store the verdict computed for one eligible slot's current crop+geometry, replacing any previous entry for the slot (degenerate sub-grid crops are never stored). */
  put(region: SlotRegion, rect: Rect, crop: GrayImage, result: MatchResult): void {
    const signature = slotCropSignature(crop);
    if (!signature) return;
    this.entries.set(region.index, {
      kind: region.kind,
      side: region.side,
      rect: { ...rect },
      width: crop.width,
      height: crop.height,
      signature,
      result,
    });
  }

  /** Drop every cached verdict AND reset the hit/miss diagnostics (capture restart, region-profile change, or content-rect change). */
  clear(): void {
    this.entries.clear();
    this.hitCountValue = 0;
    this.missCountValue = 0;
  }

  /** Number of slots currently holding a cached verdict. */
  get size(): number {
    return this.entries.size;
  }

  /** Cache hits this session (a slot's crop was unchanged and the stored verdict was served). */
  get hitCount(): number {
    return this.hitCountValue;
  }

  /** Cache misses this session (no entry, or signature/geometry mismatch — each led to a re-match). */
  get missCount(): number {
    return this.missCountValue;
  }
}

/**
 * Horizontal retry offsets (px, frame space) tried for a LOCKED pick whose
 * first match abstained. A manual grid uses ONE x per column, while the
 * portrait art inside the game's own tiles is not perfectly centred: measured
 * on the operator's real capture (manual grid fitted to the content rect),
 * blue pick B3 (Erin #155) scores 0.5272 at the grid x and 0.6880 at +8 px,
 * while every other locked pick is unaffected. The range therefore has to
 * cover roughly half a tile width's worth of art drift (±12 px on a 147 px
 * device tile, i.e. ±8%).
 */
export const LOCKED_PICK_RECOVERY_DX = [-12, -8, -4, 4, 8, 12] as const;
/**
 * Acceptance floor for a recovered locked-pick identification. Deliberately
 * STRICTER than the normal pick thresholds (0.55 score / 0.04 margin): a
 * recovered identity comes from a shifted crop, so it must be unambiguous.
 * Measured: the recovered Erin sits at 0.688 score / 0.269 margin, while an
 * EMPTY role-icon tile under the same grid reached only 0.613 — which is why
 * the retry is also restricted to LOCKED (committed) picks, never to empty or
 * pre-selection tiles.
 */
export const LOCKED_PICK_RECOVERY_MIN_SCORE = 0.6;
/** Margin floor paired with LOCKED_PICK_RECOVERY_MIN_SCORE (see that constant). */
export const LOCKED_PICK_RECOVERY_MIN_MARGIN = 0.12;

/**
 * Retry a LOCKED pick's match over LOCKED_PICK_RECOVERY_DX and return the
 * best verdict that clears both recovery floors, or null. Only called when the
 * slot's first match abstained; a locked slot is a committed portrait, so a
 * shifted crop cannot invent a hero that is not on the board.
 */
export function recoverLockedPickMatch(
  frame: { gray: GrayImage; width: number; height: number; rgba?: Uint8ClampedArray | Uint8Array },
  matcher: HeroMatcher,
  rect: Rect,
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const dx of LOCKED_PICK_RECOVERY_DX) {
    const shifted = { ...rect, x: rect.x + dx };
    if (shifted.x < 0 || shifted.x + shifted.w > frame.width) continue;
    const crop = cropGray(frame.gray, shifted);
    if (isBlankSlot(crop)) continue;
    const rgba = frame.rgba
      ? cropRgba({ data: frame.rgba, width: frame.width, height: frame.height }, shifted)
      : undefined;
    const result = matcher.match(crop, { kind: 'pick', rgba });
    if (result.abstained) continue;
    const margin = (result.candidates[0]?.score ?? 0) - (result.candidates[1]?.score ?? 0);
    if (result.score < LOCKED_PICK_RECOVERY_MIN_SCORE || margin < LOCKED_PICK_RECOVERY_MIN_MARGIN) continue;
    if (best === null || result.score > best.score) best = result;
  }
  return best;
}

/**
 * Build one SlotObservation per calibrated region slot. A slot is EMPTY when
 * its crop std is below BLANK_SLOT_STD_THRESHOLD (measured empty-vs-filled
 * clusters see the constant's doc); otherwise the matcher decides identity
 * and an abstention is emitted as `abstained: true` with the score preserved.
 *
 * For PICK slots the team-coloured lock badge is the authoritative LOCK
 * signal (badgeLock.ts, ported from the calibrator): `locked: true` when the
 * badge was detected on a non-blank crop this frame OR the caller's
 * `lockedIndexes` already latched it (a lock badge can flicker for a frame —
 * the latch keeps the state sticky for the session). An occupied, identified
 * pick with `locked: false` is a pre-selection hint the player can still
 * change; the observer treats it as an uncommitted clean stop point.
 * BAN slots carry no `locked` field. Without `frame.rgba` no badge detection
 * is possible and pick observations carry `locked: false` for occupied slots
 * (callers without colour keep pre-existing apply-anyway semantics only if
 * they omit the field — the pipeline always has colour).
 *
 * A LOCKED pick whose first match abstained gets ONE translation retry
 * (recoverLockedPickMatch) before the abstention is published: a manual grid
 * carries a single x per column, so portrait art that is not perfectly
 * centred inside the game's tile needs a few px of horizontal slack.
 *
 * `regions` overrides the profile's own slot list — the pipeline passes the
 * side-MIRRORED slots (resolveSlotSides) here. Defaults to profile.slots.
 *
 * `matchCache` (optional) memoises the matcher verdict per slot: applied to
 * BAN slots always (the ban strip is static — each icon changes at most 3
 * times per draft, with large content changes) and to PICK slots only while
 * the slot is LOCKED (a committed portrait is static for the session);
 * UNLOCKED pick slots (pre-selections, which change without a lock) are
 * ALWAYS re-matched. The verdict is only served when the crop's coarse
 * block-mean signature and its exact frame-space geometry are unchanged (see
 * SlotMatchCache); the blank classification, the lock-badge detection and the
 * observation assembly stay outside the cache and run every frame.
 */
export function buildSlotObservations(
  frame: { gray: GrayImage; width: number; height: number; rgba?: Uint8ClampedArray | Uint8Array },
  profile: RegionProfile,
  matcher: HeroMatcher,
  regions: SlotRegion[] = profile.slots,
  lockedIndexes?: ReadonlySet<number>,
  matchCache?: SlotMatchCache,
): SlotObservation[] {
  const slots: SlotObservation[] = [];
  for (const region of regions) {
    const scaled = scaleRect(region.rect, profile.resolution.width, profile.resolution.height, frame.width, frame.height);
    const crop = cropGray(frame.gray, scaled);
    const blank = isBlankSlot(crop);
    if (blank) {
      slots.push({ index: region.index, side: region.side, kind: region.kind, heroId: null, score: 0, abstained: false });
      continue;
    }
    const badge = frame.rgba
      ? detectSlotLockBadge({ data: frame.rgba, width: frame.width, height: frame.height }, scaled, region.side)
      : false;
    const locked = region.kind === 'pick' && ((lockedIndexes?.has(region.index) ?? false) || badge);
    // Kind-aware matching: ban crops use the stricter measured ban thresholds
    // (heroMatcher DEFAULTS) AND the padlock-avoiding candidate. Static slots
    // (bans, locked picks) are memoised: a signature+geometry-unchanged crop
    // serves the stored verdict — result-identical because the matcher is
    // deterministic on its crop input.
    const staticSlot = region.kind === 'ban' || locked;
    const cached = matchCache && staticSlot ? matchCache.get(region, scaled, crop) : null;
    const slotRgba = frame.rgba && cached === null
      ? cropRgba({ data: frame.rgba, width: frame.width, height: frame.height }, scaled)
      : undefined;
    let match: MatchResult = cached ?? matcher.match(crop, { kind: region.kind, banPadlock: region.kind === 'ban', rgba: slotRgba });
    // A locked (committed) pick that abstained gets one horizontal retry: the
    // manual grid carries a single x per column, while the portrait art inside
    // the game's own tile is not perfectly centred (see LOCKED_PICK_RECOVERY_DX).
    if (cached === null && region.kind === 'pick' && locked && match.abstained) {
      const recovered = recoverLockedPickMatch(frame, matcher, scaled);
      if (recovered !== null) match = recovered;
    }
    if (matchCache && staticSlot && cached === null) matchCache.put(region, scaled, crop, match);
    const observation: SlotObservation = {
      index: region.index,
      side: region.side,
      kind: region.kind,
      heroId: match.abstained ? null : match.heroId,
      score: match.score,
      abstained: match.abstained,
    };
    if (region.kind === 'pick') observation.locked = locked;
    // A ban identification is an ESTIMATE, never a fact: mark every
    // vision-produced ban identity so the observer treats it softly (see
    // SlotObservation.estimated and the DraftObserver module doc).
    if (region.kind === 'ban' && !match.abstained && observation.heroId !== null) observation.estimated = true;
    slots.push(observation);
  }
  return slots;
}

/** Re-export useful helper for consumers that need to compare positions. */
export { getDraftSequence };

/** Type re-exports for consumers without deep imports (SideCrossCheck is
 * defined and exported above in this module; RgbaPlane and CaptureFrame live
 * in types.ts and are re-exported from here for compatibility). */
export type { DraftObservation, SlotObservation, ObserverResult, VisionRecommendation };
export type { RgbaPlane, CaptureFrame, SurfaceSlotRect } from './types';
