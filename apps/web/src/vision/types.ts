/**
 * Frozen contracts for the live draft advisor vision layer (screen capture ->
 * slot recognition -> hero matching). Pure data shapes only: no React, no DOM
 * types, no engine imports.
 */

/** Side of the draft board being observed. */
export type VisionSide = 'blue' | 'red';

/** Whether a slot region is a ban slot or a pick slot. */
export type VisionSlotKind = 'ban' | 'pick';

/** An RGBA pixel plane with ImageData's shape (alpha is ignored). */
export interface RgbaPlane { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** One downscaled frame captured from the shared screen: the grayscale plane
 * consumed by the matcher plus the raw RGBA plane that carries the colour
 * information (team tint / lock badge). Both views come from ONE getImageData
 * read; `gray` is the Rec.601 luminance of `rgba`. Structurally assignable to
 * RgbaPlane via `{ data: frame.rgba, width, height }`. */
export interface CaptureFrame {
  gray: GrayImage;
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  ts: number;
}

/** Single-channel image with one representation: Float32Array samples. Raw
 * producers (toGray/resizeGray/cropGray/aspectFit) carry samples in 0..255;
 * normalized images (from `normalizeGray` in geometry.ts) carry
 * zero-mean/unit-variance samples and MAY be negative. */
export interface GrayImage { width: number; height: number; data: Float32Array }

/** Axis-aligned rectangle in image pixel coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }

/** One calibrated slot of the Ban&Pick board (empty rect until calibration). */
export interface SlotRegion { index: number; rect: Rect; side: VisionSide; kind: VisionSlotKind }

/**
 * A slot rectangle expressed in FULL capture-surface pixel coordinates (the
 * same space as the preview frame), ready for overlay drawing: already scaled
 * from the profile's content space and offset by the content rect's origin,
 * so the panel never needs to know about content rects.
 */
export interface SurfaceSlotRect { index: number; side: VisionSide; kind: VisionSlotKind; rect: Rect }

/** A fixed UI landmark used by the calibration lane to detect the draft screen. */
export interface AnchorRegion { label: string; rect: Rect }

/** Per-resolution layout of the Ban&Pick screen. */
export interface RegionProfile {
  /** Client-build tag of the profile (e.g. 'uncalibrated'). */
  version: string;
  /** Native resolution this profile was calibrated for. */
  resolution: { width: number; height: number };
  /** Slot rects; empty until calibrated (later lane). */
  slots: SlotRegion[];
  /** Anchor rects used to verify the draft screen is visible. */
  anchors: AnchorRegion[];
  /**
   * The absolute side of the LEFT (own-team) column AS CAPTURED in this
   * profile. The HoK ranked board always renders the operator's own team on
   * the left and the opponent on the right; the colour tint (and therefore the
   * absolute side) mirrors per session. Profile `SlotRegion.side` values
   * describe the captured session (left column = `ownSide`); at runtime the
   * sides must be resolved by MIRRORING against the operator's declared side
   * (see `resolveSlotSides` in regionMap.ts). Defaults to 'red' when absent.
   */
  ownSide?: VisionSide;
}

/** Scored hero candidate from the matcher. */
export interface MatchCandidate { heroId: number; score: number }

/** Matcher verdict for one slot crop; `heroId` is null when abstained. */
export interface MatchResult {
  heroId: number | null;
  score: number;
  abstained: boolean;
  candidates: MatchCandidate[];
}

/**
 * Preprocessed portrait reference used by HeroMatcher. `full64` (optional) is
 * the full-resolution normalized 64x64 portrait that the ban-specific matcher
 * needs to synthesize circle-masked, zoomed, shifted "ban-style" variants; when
 * absent the matcher keeps the legacy ban behaviour for that entry.
 */
export interface ReferenceEntry { heroId: number; hash: bigint; thumb: GrayImage; full64?: GrayImage; cb64?: GrayImage; cr64?: GrayImage }

/** Recognition outcome for one board slot. Every region-profile slot must be
 * present in an observation: `heroId === null && abstained === false` → slot
 * visibly empty (the draft has not reached it); `heroId === null &&
 * abstained === true` → slot occupied but unidentified; `heroId !== null` →
 * slot occupied and identified (confidence in `score`).
 *
 * `locked` is only set on PICK slots: true when the team-coloured lock badge
 * has been detected for this slot in the current capture session (latched —
 * the badge can flicker for a frame, a lock never un-locks), false when the
 * portrait is visible but NOT locked. An occupied, identified pick with
 * `locked === false` is a PRE-SELECTION hint ("Pilih Dulu") that the player
 * can still change — the observer treats it as an uncommitted clean stop
 * point, never as a made pick. Observations from callers that cannot detect
 * the badge (no RGBA plane) omit the field, which keeps the pre-existing
 * "any identified pick applies" behaviour.
 *
 * `estimated` is only meaningful on BAN slots: a ban crop that survived the
 * stricter per-kind thresholds still cannot be trusted as fact (the padlock
 * badge covers ~40% of the 64px circle; the measured corpus has no
 * trustworthy ban identification), so every vision-produced ban identity is
 * marked `estimated: true` and the observer treats it EXACTLY like a ban it
 * could not identify — soft: counted, the replay advances past it, picks
 * still apply, and the hero is NOT removed from the recommendation pool.
 * Observations without the field keep the pre-existing behaviour (relevant
 * for hand-built observations in tests).
 *
 * ORDERING CONTRACT: within each (side, kind) group the observations MUST be
 * supplied in CHRONOLOGICAL fill order (the order the slots became occupied on
 * screen over time). The observer consumes the array order, never `index` —
 * on the HoK ranked board the left column's rows are ordered by ROLE, not by
 * pick order, so `index` (UI position) is NOT chronological. */
export interface SlotObservation {
  index: number;
  side: VisionSide;
  kind: VisionSlotKind;
  heroId: number | null;
  score: number;
  abstained: boolean;
  /** Pick slots only: latched lock-badge state (see the note above). */
  locked?: boolean;
  /** BAN slots only: the identity survived the stricter ban thresholds but is an ESTIMATE, never a fact (see the note above). */
  estimated?: boolean;
}

/** A full snapshot of the captured draft board at one instant. */
export interface DraftObservation { ts: number; screen: 'draft' | 'unknown'; slots: SlotObservation[]; side: VisionSide }
