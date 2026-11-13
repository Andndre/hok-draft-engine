/**
 * Parametric manual grid builder for Live Draft Advisor. Allows the operator
 * to position Pick (top-row X/Y/size + bottom-row Y, with intermediate rows
 * interpolated) and Ban (anchor X/Y/size + spacing + count per side) directly
 * on the shared frame for any window chrome or device aspect ratio (20:9 phone,
 * 16:9, 16:10 tablet, 4:3 iPad). Pure TypeScript, safe to import in Node.
 */

import type { RegionProfile, SlotRegion } from './types';

/** Normalized [0..1] manual layout anchors; sizes are relative to frame height so slots stay square on any aspect ratio. */
export interface ManualLayoutConfig {
  /** Horizontal symmetry axis in normalized [0..1] frame width (default 0.5). */
  centerX?: number;
  pick: {
    leftX: number;
    rightX: number;
    mirrorX: boolean;
    centerX?: number;
    topY: number;
    bottomY: number;
    size: number;
  };
  ban: {
    countPerSide: 3 | 5;
    leftX: number;
    rightX: number;
    mirrorX: boolean;
    centerX?: number;
    y: number;
    size: number;
    stepX: number;
  };
}

const STORAGE_KEY = 'hok_vision_manual_layout_v1';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Default normalized anchors seeded from the calibrated 2800x1260 Ranked layout. */
export function defaultManualLayoutConfig(countPerSide: 3 | 5 = 3): ManualLayoutConfig {
  // Anchors are the MEASURED calibrated rects of the Ranked 2800x1260 profile
  // (tests/fixtures/vision/region-profile-2800x1260.json), normalized to the
  // frame: pick column x 183 / 2485, rows 142 -> 950, tile 147; ban icons at
  // y 15, 64 px, 86 px pitch, left column 173 and right column 2564.
  // The two columns are NOT exactly symmetric about the frame centre (the
  // measured mirror axis is x = 1407.5 for picks, 1400.5 for bans), so the
  // centre anchors below encode the measured axis instead of a hard 0.5.
  return {
    centerX: 0.5,
    pick: {
      leftX: 183 / 2800,
      rightX: 2485 / 2800,
      mirrorX: true,
      centerX: 2815 / 5600,
      topY: 142 / 1260,
      bottomY: 950 / 1260,
      size: 147 / 1260,
    },
    ban: {
      countPerSide,
      leftX: 173 / 2800,
      rightX: 2564 / 2800,
      mirrorX: true,
      centerX: 2801 / 5600,
      y: 15 / 1260,
      size: 64 / 1260,
      stepX: 86 / 2800,
    },
  };
}

/** Clamp all fields of a ManualLayoutConfig into safe normalized bounds. */
export function sanitizeManualLayoutConfig(raw: Partial<ManualLayoutConfig> | null | undefined): ManualLayoutConfig {
  const base = defaultManualLayoutConfig(raw?.ban?.countPerSide === 5 ? 5 : 3);
  if (!raw) return base;
  const pick = raw.pick ?? base.pick;
  const ban = raw.ban ?? base.ban;
  const topY = clamp(Number.isFinite(pick.topY) ? pick.topY : base.pick.topY, 0.02, 0.75);
  const bottomY = clamp(Number.isFinite(pick.bottomY) ? pick.bottomY : base.pick.bottomY, topY + 0.12, 0.92);
  const centerX = clamp(typeof raw.centerX === 'number' && Number.isFinite(raw.centerX) ? raw.centerX : 0.5, 0.40, 0.60);
  const pickCenterX = clamp(typeof pick.centerX === 'number' && Number.isFinite(pick.centerX) ? pick.centerX : centerX, 0.40, 0.60);
  const banCenterX = clamp(typeof ban.centerX === 'number' && Number.isFinite(ban.centerX) ? ban.centerX : centerX, 0.40, 0.60);
  return {
    centerX,
    pick: {
      leftX: clamp(Number.isFinite(pick.leftX) ? pick.leftX : base.pick.leftX, 0, 0.45),
      rightX: clamp(Number.isFinite(pick.rightX) ? pick.rightX : base.pick.rightX, 0.5, 0.96),
      mirrorX: typeof pick.mirrorX === 'boolean' ? pick.mirrorX : base.pick.mirrorX,
      centerX: pickCenterX,
      topY,
      bottomY,
      size: clamp(Number.isFinite(pick.size) ? pick.size : base.pick.size, 0.04, 0.22),
    },
    ban: {
      countPerSide: ban.countPerSide === 5 ? 5 : 3,
      leftX: clamp(Number.isFinite(ban.leftX) ? ban.leftX : base.ban.leftX, 0, 0.45),
      rightX: clamp(Number.isFinite(ban.rightX) ? ban.rightX : base.ban.rightX, 0.5, 0.98),
      mirrorX: typeof ban.mirrorX === 'boolean' ? ban.mirrorX : base.ban.mirrorX,
      centerX: banCenterX,
      y: clamp(Number.isFinite(ban.y) ? ban.y : base.ban.y, 0, 0.45),
      size: clamp(Number.isFinite(ban.size) ? ban.size : base.ban.size, 0.02, 0.14),
      stepX: clamp(Number.isFinite(ban.stepX) ? ban.stepX : base.ban.stepX, 0.012, 0.10),
    },
  };
}

/** Build a pixel-space RegionProfile for `(frameWidth, frameHeight)` from manual anchors. */
export function buildManualRegionProfile(
  config: ManualLayoutConfig,
  frameWidth: number,
  frameHeight: number,
): RegionProfile {
  const safe = sanitizeManualLayoutConfig(config);
  const w = Math.max(1, Math.round(frameWidth));
  const h = Math.max(1, Math.round(frameHeight));

  const fallbackCenterX = safe.centerX ?? 0.5;
  const pickCenterX = safe.pick.centerX ?? fallbackCenterX;
  const banCenterX = safe.ban.centerX ?? fallbackCenterX;
  const pickSide = clamp(Math.round(safe.pick.size * h), 12, Math.round(h * 0.4));
  const pickLeftX = clamp(Math.round(safe.pick.leftX * w), 0, Math.max(0, w - pickSide));
  const pickRightX = safe.pick.mirrorX
    ? clamp(Math.round(2 * pickCenterX * w) - pickLeftX - pickSide, 0, Math.max(0, w - pickSide))
    : clamp(Math.round(safe.pick.rightX * w), 0, Math.max(0, w - pickSide));
  const topY = clamp(Math.round(safe.pick.topY * h), 0, Math.max(0, h - pickSide));
  const bottomY = clamp(Math.round(safe.pick.bottomY * h), topY + 4, Math.max(topY + 4, h - pickSide));

  const slots: SlotRegion[] = [];
  for (let row = 0; row < 5; row += 1) {
    const y = Math.round(topY + (row / 4) * (bottomY - topY));
    slots.push({
      index: row,
      side: 'red',
      kind: 'pick',
      rect: { x: pickLeftX, y, w: pickSide, h: pickSide },
    });
  }
  for (let row = 0; row < 5; row += 1) {
    const y = Math.round(topY + (row / 4) * (bottomY - topY));
    slots.push({
      index: 5 + row,
      side: 'blue',
      kind: 'pick',
      rect: { x: pickRightX, y, w: pickSide, h: pickSide },
    });
  }

  const banCount = safe.ban.countPerSide;
  const banSide = clamp(Math.round(safe.ban.size * h), 8, Math.round(h * 0.22));
  const banY = clamp(Math.round(safe.ban.y * h), 0, Math.max(0, h - banSide));
  const banLeftX = clamp(Math.round(safe.ban.leftX * w), 0, Math.max(0, w - banSide));
  const banRightOuterX = safe.ban.mirrorX
    ? clamp(Math.round(2 * banCenterX * w) - banLeftX - banSide, 0, Math.max(0, w - banSide))
    : clamp(Math.round(safe.ban.rightX * w), 0, Math.max(0, w - banSide));
  const banStep = Math.max(banSide * 0.6, safe.ban.stepX * w);

  for (let i = 0; i < banCount; i += 1) {
    slots.push({
      index: 10 + i,
      side: 'red',
      kind: 'ban',
      rect: {
        x: clamp(Math.round(banLeftX + i * banStep), 0, Math.max(0, w - banSide)),
        y: banY,
        w: banSide,
        h: banSide,
      },
    });
  }
  for (let i = 0; i < banCount; i += 1) {
    // Blue bans are indexed LEFT-TO-RIGHT like the calibrated profile (index
    // 13 is the leftmost icon of the right-hand strip), so the chronological
    // fill order the observer consumes matches the game's own strip order.
    slots.push({
      index: 10 + banCount + i,
      side: 'blue',
      kind: 'ban',
      rect: {
        x: clamp(Math.round(banRightOuterX - (banCount - 1 - i) * banStep), 0, Math.max(0, w - banSide)),
        y: banY,
        w: banSide,
        h: banSide,
      },
    });
  }

  return {
    version: 'manual-v1',
    resolution: { width: w, height: h },
    ownSide: 'red',
    slots,
    anchors: [],
  };
}

/** Load saved manual layout config from localStorage, or fall back to defaults. */
export function loadManualLayoutConfig(countPerSide: 3 | 5 = 3): ManualLayoutConfig {
  try {
    if (typeof localStorage === 'undefined') return defaultManualLayoutConfig(countPerSide);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultManualLayoutConfig(countPerSide);
    return sanitizeManualLayoutConfig(JSON.parse(raw) as Partial<ManualLayoutConfig>);
  } catch {
    return defaultManualLayoutConfig(countPerSide);
  }
}

/** Persist manual layout config to localStorage (no-op in non-browser environments). */
export function saveManualLayoutConfig(config: ManualLayoutConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeManualLayoutConfig(config)));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}
