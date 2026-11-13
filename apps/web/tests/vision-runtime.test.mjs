// Runtime-defect regression tests: the measured blank-slot threshold, the
// ported chevron/badge lock detector, the ban-glow rejection, and the
// end-to-end colour-side cross-check wiring (RGBA plane -> inspectColourFrame
// -> onSideCheck event).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLANK_SLOT_STD_THRESHOLD,
  buildSlotObservations,
  shouldRunColourCheck,
  COLOUR_CHECK_INTERVAL_MS,
  VisionPipeline,
  SlotMatchCache,
  SLOT_CACHE_SIGNATURE_TOLERANCE,
  slotCropSignature,
  slotSignaturesMatch,
  detectLeftColumnSide,
  sideCrossCheck,
  sortSlotsChronologically,
  scaleRect,
} from '../src/vision/pipeline.ts';
import { buildManualRegionProfile, defaultManualLayoutConfig } from '../src/vision/manualLayout.ts';
import { badgeStrictCounts, detectSlotLockBadge, LOCK_BADGE_PROBE } from '../src/vision/badgeLock.ts';
import { unidentifiedBansMessage } from '../src/vision/observer.ts';

function grayImage(width, height, fill) {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    data[i] = fill(x, y, i);
  }
  return { width, height, data };
}

function rgbaPlane(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      const p = (y * width + x) * 4;
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Defect 1: the measured blank threshold + synthetic placeholder crops
// ---------------------------------------------------------------------------

test('the blank threshold sits between the measured empty and occupied clusters', () => {
  // Corpus measurement (both drafts, correct windows): empty placeholders
  // std 8.3..26.8, occupied crops std 31.0..68.4. 30.0 keeps a margin on
  // both sides (3.2 above empty, 4.0 below occupied).
  assert.equal(BLANK_SLOT_STD_THRESHOLD, 30.0);
  assert.ok(26.8 < BLANK_SLOT_STD_THRESHOLD && BLANK_SLOT_STD_THRESHOLD < 31.0);
});

test('an empty-placeholder-like crop (flat tint + small glyph) is classified EMPTY by buildSlotObservations', () => {
  // Mirrors the corpus placeholder: flat team tint + a small darker helmet
  // glyph (~5% of pixels), grayscale std ~9 (measured empty range 8.3..26.8).
  const frame = {
    gray: grayImage(147, 147, (x, y) => {
      const inGlyph = (y >= 40 && y < 95 && Math.abs(x - 72) < (y > 55 && y < 80 ? 20 : 12));
      return inGlyph ? 20 : 60;
    }),
    width: 147,
    height: 147,
  };
  const profile = {
    version: 'runtime-test',
    resolution: { width: 147, height: 147 },
    slots: [{ index: 0, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 147, h: 147 } }],
    anchors: [],
  };
  const matcher = { referenceCount: 1, match: () => { throw new Error('matcher must not run on an empty slot'); } };
  const slots = buildSlotObservations(frame, profile, matcher);
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0], { index: 0, side: 'red', kind: 'pick', heroId: null, score: 0, abstained: false });
});

test('a portrait-like crop is classified FILLED (occupied, not blank)', () => {
  const frame = {
    gray: grayImage(147, 147, (x, y) => 60 + ((x * 7 + y * 13) % 5) * 30),
    width: 147,
    height: 147,
  };
  const profile = {
    version: 'runtime-test',
    resolution: { width: 147, height: 147 },
    slots: [{ index: 0, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 147, h: 147 } }],
    anchors: [],
  };
  const matcher = { referenceCount: 1, match: () => ({ heroId: 521, score: 0.8, abstained: false, candidates: [] }) };
  const slots = buildSlotObservations(frame, profile, matcher);
  assert.equal(slots[0].abstained, false);
  assert.equal(slots[0].heroId, 521);
  assert.equal(slots[0].locked, false, 'no badge -> visible portrait is a pre-selection, not a lock');
});

test('ban identifications are marked estimated (an estimate, never a fact); picks are not', () => {
  const frame = {
    gray: grayImage(64, 64, (x, y) => 60 + ((x * 7 + y * 13) % 5) * 30),
    width: 64,
    height: 64,
  };
  const profile = {
    version: 'runtime-test',
    resolution: { width: 64, height: 64 },
    slots: [
      { index: 0, side: 'red', kind: 'ban', rect: { x: 0, y: 0, w: 64, h: 64 } },
      { index: 1, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 64, h: 64 } },
    ],
    anchors: [],
  };
  const matcher = {
    referenceCount: 1,
    seenKinds: [],
    match(crop, options) {
      this.seenKinds.push(options.kind);
      return { heroId: 521, score: 0.9, abstained: false, candidates: [] };
    },
  };
  const slots = buildSlotObservations(frame, profile, matcher);
  assert.equal(slots[0].estimated, true, 'a surviving ban identity must be marked estimated');
  assert.equal(slots[0].heroId, 521);
  assert.equal(slots[1].estimated, undefined, 'pick identities are facts, not estimates');
  // The matcher must receive the slot's kind for the per-kind thresholds.
  assert.deepEqual(matcher.seenKinds, ['ban', 'pick']);
});

// ---------------------------------------------------------------------------
// Defect 1: the ported chevron/badge lock detector
// ---------------------------------------------------------------------------

const SLOT = { x: 20, y: 20, w: 147, h: 147 };
const PROBE = {
  x: SLOT.x + LOCK_BADGE_PROBE.fx0 * SLOT.w,
  y: SLOT.y + LOCK_BADGE_PROBE.fy0 * SLOT.h,
  w: (LOCK_BADGE_PROBE.fx1 - LOCK_BADGE_PROBE.fx0) * SLOT.w,
  h: (LOCK_BADGE_PROBE.fy1 - LOCK_BADGE_PROBE.fy0) * SLOT.h,
};

test('badgeStrictCounts ports the calibrator intensity gates bit for bit', () => {
  // warm: r > b + 60 && r >= 150; cool: b > r + 60 && b >= 150.
  const rgba = rgbaPlane(8, 4, (x, y) => {
    if (y === 0) return [200, 40, 50];      // warm
    if (y === 1) return [150, 40, 100];     // r == b + 50: NOT warm (needs > 60)
    if (y === 2) return [40, 40, 200];      // cool
    return [120, 120, 120];                 // neutral
  });
  const counts = badgeStrictCounts(rgba, { x: 0, y: 0, w: 8, h: 4 });
  assert.deepEqual(counts, { warm: 8, cool: 8 });
  // A rect fully outside the plane is clamped to zero.
  assert.deepEqual(badgeStrictCounts(rgba, { x: 100, y: 100, w: 4, h: 4 }), { warm: 0, cool: 0 });
});

test('a crop containing the badge geometry is detected LOCKED for the matching side', () => {
  // Solid bright red chevron filling the probe zone -> warm count ~= probe
  // area >> LOCK_BADGE_MIN_RATIO * area.
  const red = rgbaPlane(200, 200, (x, y) => (
    x >= PROBE.x && x < PROBE.x + PROBE.w && y >= PROBE.y && y < PROBE.y + PROBE.h
      ? [220, 40, 40]
      : [63, 23, 33]
  ));
  assert.equal(detectSlotLockBadge(red, SLOT, 'red'), true);
  assert.equal(detectSlotLockBadge(red, SLOT, 'blue'), false, 'wrong-side colour must not lock');

  const blue = rgbaPlane(200, 200, (x, y) => (
    x >= PROBE.x && x < PROBE.x + PROBE.w && y >= PROBE.y && y < PROBE.y + PROBE.h
      ? [40, 60, 220]
      : [9, 36, 66]
  ));
  assert.equal(detectSlotLockBadge(blue, SLOT, 'blue'), true);
  assert.equal(detectSlotLockBadge(blue, SLOT, 'red'), false);

  // A partial badge (left half of the probe, ~50% coverage) must still lock;
  // a small corner (10x10 px ~= 4% of the ~2470 px probe) must not.
  const probeX0 = Math.floor(PROBE.x);
  const probeY0 = Math.floor(PROBE.y);
  const probeW = Math.floor(PROBE.w);
  const probeH = Math.floor(PROBE.h);
  const sparse = rgbaPlane(200, 200, (x, y) => {
    const inProbe = x >= probeX0 && x < probeX0 + probeW && y >= probeY0 && y < probeY0 + probeH;
    const inBadge = x < probeX0 + probeW / 2; // left half of the probe
    return inProbe && inBadge ? [220, 40, 40] : [63, 23, 33];
  });
  assert.equal(detectSlotLockBadge(sparse, SLOT, 'red'), true, '50% badge coverage clears the 4.5% ratio');
  const faint = rgbaPlane(200, 200, (x, y) => {
    const inProbe = x >= probeX0 && x < probeX0 + probeW && y >= probeY0 && y < probeY0 + probeH;
    const inBadge = x >= probeX0 && x < probeX0 + 10 && y >= probeY0 && y < probeY0 + 10; // 100 px ~= 4%
    return inProbe && inBadge ? [220, 40, 40] : [63, 23, 33];
  });
  assert.equal(detectSlotLockBadge(faint, SLOT, 'red'), false, '~4% coverage stays below the ratio');
});

test('the ban-phase glow cannot fake a lock: the blank-std gate rejects a bright probe on an empty tile', () => {
  // Corpus frames 028-030: the ban timer glow bleeds 245-446 bright warm
  // pixels into the badge probe while the pick tile is still the empty
  // placeholder (std <= 26.8). The classification must stay EMPTY, and no
  // lock may latch.
  const frame = {
    gray: grayImage(147, 147, () => 60), // flat empty placeholder (std 0)
    rgba: rgbaPlane(147, 147, (x, y) => (
      x >= PROBE.x - SLOT.x && x < PROBE.x - SLOT.x + PROBE.w && y >= PROBE.y - SLOT.y && y < PROBE.y - SLOT.y + PROBE.h
        ? [255, 60, 40] // bright warm glow inside the badge probe zone
        : [63, 23, 33]
    )),
    width: 147,
    height: 147,
    ts: 1000,
  };
  const profile = {
    version: 'runtime-test',
    resolution: { width: 147, height: 147 },
    slots: [{ index: 0, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 147, h: 147 } }],
    anchors: [],
  };
  const matcher = { referenceCount: 1, match: () => ({ heroId: 521, score: 0.8, abstained: false, candidates: [] }) };
  const slots = buildSlotObservations(frame, profile, matcher);
  assert.deepEqual(slots[0], { index: 0, side: 'red', kind: 'pick', heroId: null, score: 0, abstained: false },
    'flat tile stays EMPTY even when the probe zone glows warm');
});

test('a locked pick latches through buildSlotObservations via lockedIndexes', () => {
  const frame = {
    gray: grayImage(147, 147, (x, y) => 60 + ((x * 7 + y * 13) % 5) * 30),
    rgba: rgbaPlane(147, 147, (x, y) => (
      x >= PROBE.x - SLOT.x && x < PROBE.x - SLOT.x + PROBE.w && y >= PROBE.y - SLOT.y && y < PROBE.y - SLOT.y + PROBE.h
        ? [220, 40, 40]
        : [63, 23, 33]
    )),
    width: 147,
    height: 147,
  };
  const profile = {
    version: 'runtime-test',
    resolution: { width: 147, height: 147 },
    slots: [{ index: 0, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 147, h: 147 } }],
    anchors: [],
  };
  const matcher = { referenceCount: 1, match: () => ({ heroId: 521, score: 0.8, abstained: false, candidates: [] }) };
  const latched = buildSlotObservations(frame, profile, matcher, undefined, new Set([0]));
  assert.equal(latched[0].locked, true, 'latched lock survives a badge flicker frame');
});

// ---------------------------------------------------------------------------
// Defect 3: the RGBA plane reaches inspectColourFrame end-to-end
// ---------------------------------------------------------------------------

function draftFrameRgba(leftTile) {
  // 2800x1260 frame with the calibrated own-column pick tiles filled with the
  // given tint and everything else the dark navy scene background.
  const profileTiles = [
    { x: 186, y: 142, w: 148, h: 154 }, { x: 183, y: 343, w: 146, h: 150 },
    { x: 183, y: 543, w: 147, h: 147 }, { x: 183, y: 746, w: 147, h: 147 },
    { x: 183, y: 950, w: 147, h: 147 },
  ];
  return rgbaPlane(2800, 1260, (x, y) => {
    for (const t of profileTiles) {
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h * 0.8) return leftTile;
    }
    return [24, 26, 34];
  });
}

test('inspectColourFrame reads the RGBA plane directly: warm left column detects red with an event', () => {
  const events = [];
  const pipeline = new VisionPipeline({ heroes: [], side: 'red', manualLayout: defaultManualLayoutConfig(3) }, { onSideCheck: check => events.push(check) });
  const check = pipeline.inspectColourFrame(draftFrameRgba([63, 23, 33]), 1234);
  assert.ok(check);
  assert.deepEqual(check, { detected: 'red', declared: 'red', mismatch: false, checkedAt: 1234 });
  assert.equal(events.length, 1);
  assert.equal(pipeline.lastSideCheck, check);
  pipeline.stop();
});

test('inspectColourFrame flags a confident mismatch without switching the declared side', () => {
  const events = [];
  const pipeline = new VisionPipeline({ heroes: [], side: 'red', manualLayout: defaultManualLayoutConfig(3) }, { onSideCheck: check => events.push(check) });
  const check = pipeline.inspectColourFrame(draftFrameRgba([9, 36, 66]), 1234);
  assert.ok(check);
  assert.equal(check.detected, 'blue');
  assert.equal(check.declared, 'red', 'the declared side stays authoritative');
  assert.equal(check.mismatch, true);
  assert.equal(events.length, 1);
  pipeline.stop();
});

test('an ambiguous frame yields no check and NO event', () => {
  const events = [];
  const pipeline = new VisionPipeline({ heroes: [], side: 'red', manualLayout: defaultManualLayoutConfig(3) }, { onSideCheck: check => events.push(check) });
  const check = pipeline.inspectColourFrame(draftFrameRgba([24, 26, 34]), 1234);
  assert.equal(check, null, 'unknown detection returns null');
  assert.equal(events.length, 0, 'onSideCheck is never emitted for unknown');
  pipeline.stop();
});

test('shouldRunColourCheck gates the automatic cross-check at COLOUR_CHECK_INTERVAL_MS', () => {
  assert.equal(COLOUR_CHECK_INTERVAL_MS, 500);
  assert.equal(shouldRunColourCheck(null, 1000), true, 'first frame always checks');
  assert.equal(shouldRunColourCheck(1000, 1400), false, 'inside the interval');
  assert.equal(shouldRunColourCheck(1000, 1500), true, 'exactly at the interval boundary');
  assert.equal(shouldRunColourCheck(1000, 2000), true, 'past the interval');
});

test('detectLeftColumnSide + sideCrossCheck compose into the exact panel payload', () => {
  const detected = detectLeftColumnSide(draftFrameRgba([63, 23, 33]), [
    { x: 186, y: 142, w: 148, h: 123 },
  ]);
  assert.equal(detected, 'red');
  const check = sideCrossCheck(detected, 'blue', 99);
  assert.deepEqual(check, { detected: 'red', declared: 'blue', mismatch: true, checkedAt: 99 });
});

// ---------------------------------------------------------------------------
// Defect 2: the soft unidentified-ban signal fragment
// ---------------------------------------------------------------------------

test('unidentifiedBansMessage renders the Indonesian UI fragment', () => {
  assert.equal(unidentifiedBansMessage(0), '0 ban tidak teridentifikasi');
  assert.equal(unidentifiedBansMessage(2), '2 ban tidak teridentifikasi');
});

test('sortSlotsChronologically ranks locked picks before pre-selections regardless of fill order', () => {
  // A pre-selection that appeared EARLIER must not overtake a later lock:
  // the observer stops at the first unlocked pick, so committed locks have to
  // form the consumed prefix.
  const slots = [
    { index: 5, side: 'red', kind: 'pick', heroId: 175, score: 0.7, abstained: false, locked: false }, // pre-selection, filled first
    { index: 6, side: 'red', kind: 'pick', heroId: 108, score: 0.8, abstained: false, locked: true },  // locked later
    { index: 7, side: 'red', kind: 'pick', heroId: null, score: 0, abstained: false },                 // empty
  ];
  const sorted = sortSlotsChronologically(slots, new Map([[5, 100], [6, 900]]), new Map([[6, 900]]));
  assert.deepEqual(sorted.map(s => s.index), [6, 5, 7]);
});

// ---------------------------------------------------------------------------
// Resolution-tolerant profile resolution (live captures smaller than 2800x1260)
// ---------------------------------------------------------------------------

function scaledDraftFrameRgba(width, height) {
  // The draftFrameRgba fixture scaled to a smaller same-aspect surface: the
  // profile's own-column pick tiles shrink proportionally (scale = width/2800),
  // which is exactly what scaleRect does in the pipeline.
  const scale = width / 2800;
  const profileTiles = [
    { x: 186, y: 142, w: 148, h: 154 }, { x: 183, y: 343, w: 146, h: 150 },
    { x: 183, y: 543, w: 147, h: 147 }, { x: 183, y: 746, w: 147, h: 147 },
    { x: 183, y: 950, w: 147, h: 147 },
  ];
  return rgbaPlane(width, height, (x, y) => {
    for (const t of profileTiles) {
      const sx = t.x * scale, sy = t.y * scale, sw = t.w * scale, sh = t.h * scale;
      if (x >= sx && x < sx + sw && y >= sy && y < sy + sh * 0.8) return [63, 23, 33];
    }
    return [24, 26, 34];
  });
}

test('inspectColourFrame resolves the calibrated profile from a downscaled same-aspect frame', () => {
  // 1400x630 (scale 0.5) matches no exact profile; the tolerant lookup must
  // still find the calibrated 2800x1260 layout so the colour check works on a
  // small scrcpy window instead of reporting "not calibrated" forever.
  const pipeline = new VisionPipeline({ heroes: [], side: 'red', manualLayout: defaultManualLayoutConfig(3) });
  const check = pipeline.inspectColourFrame(scaledDraftFrameRgba(1400, 630), 1234);
  assert.ok(check, 'a same-aspect downscaled frame must be colour-checked');
  assert.equal(check.detected, 'red');
  assert.equal(check.mismatch, false);
  pipeline.stop();
});

// Per-slot match cache: static-slot memoisation with content-signature
// invalidation (a changed crop must NEVER be served a stale match)
// ---------------------------------------------------------------------------

/** Portrait-like crop patterns: two genuinely DIFFERENT arts (spatial structure and levels both differ, so every block mean moves). */
function portraitPattern(seed) {
  if (seed === 0) return (x, y) => (((x >> 3) + (y >> 3)) % 2 === 0 ? 40 : 215);
  return (x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 90 : 230);
}

function banSlotProfile() {
  return {
    version: 'match-cache-test',
    resolution: { width: 280, height: 280 },
    slots: [
      { index: 0, side: 'red', kind: 'ban', rect: { x: 0, y: 0, w: 140, h: 140 } },
      { index: 1, side: 'red', kind: 'pick', rect: { x: 140, y: 0, w: 140, h: 140 } },
    ],
    anchors: [],
  };
}

/** Frame whose ban slot carries portrait pattern `seed` (null = flat/blank) and pick slot carries `pickSeed` (null = flat/blank). */
function cacheTestFrame(banSeed, pickSeed) {
  return {
    gray: grayImage(280, 280, (x, y) => {
      if (x < 140 && y < 140) return banSeed === null ? 60 : portraitPattern(banSeed)(x, y);
      if (pickSeed === null) return 60;
      return portraitPattern(pickSeed)(x, y);
    }),
    width: 280,
    height: 280,
  };
}

/** Matcher mock counting calls; returns a per-call-number verdict. */
function countingMatcher(results) {
  let calls = 0;
  return {
    referenceCount: 1,
    get callCount() { return calls; },
    match() {
      const result = results[Math.min(calls, results.length - 1)];
      calls += 1;
      return result;
    },
  };
}

test('the slot signature is an 8x8 block-mean grid, insensitive to noise within the tolerance', () => {
  const cropA = { width: 64, height: 64, data: Float32Array.from({ length: 64 * 64 }, (_, i) => portraitPattern(0)(i % 64, Math.floor(i / 64))) };
  const signature = slotCropSignature(cropA);
  assert.ok(signature);
  assert.equal(signature.length, 64);
  assert.ok(signature.every(v => v >= 0 && v <= 255), 'block means stay on the 0..255 scale');
  // A same-content crop with small per-pixel noise (block means shift <= 0.5,
  // inside the tolerance) must match; a different portrait must not.
  const noisy = { width: 64, height: 64, data: Float32Array.from(cropA.data, v => v + ((Math.sin(v) > 0 ? 1 : -1) * 0.5)) };
  assert.equal(slotSignaturesMatch(signature, slotCropSignature(noisy)), true, 'noise within the tolerance cannot invalidate');
  const different = { width: 64, height: 64, data: Float32Array.from({ length: 64 * 64 }, (_, i) => portraitPattern(1)(i % 64, Math.floor(i / 64))) };
  assert.equal(slotSignaturesMatch(signature, slotCropSignature(different)), false, 'a changed icon must invalidate');
  assert.equal(slotCropSignature({ width: 7, height: 64, data: new Float32Array(7 * 64) }), null, 'sub-grid crops are never signature-cached');
  assert.equal(SLOT_CACHE_SIGNATURE_TOLERANCE, 1.0);
});

test('SlotMatchCache serves an unchanged crop and INVALIDATES on a changed crop or geometry', () => {
  const cache = new SlotMatchCache();
  const region = { index: 0, side: 'red', kind: 'ban', rect: { x: 0, y: 0, w: 64, h: 64 } };
  const rect = { x: 10, y: 20, w: 64, h: 64 };
  const result = { heroId: 507, score: 0.9, abstained: false, candidates: [] };
  assert.equal(cache.get(region, rect, grayImage(64, 64, portraitPattern(0))), null, 'empty cache misses');
  cache.put(region, rect, grayImage(64, 64, portraitPattern(0)), result);
  const same = cache.get(region, rect, grayImage(64, 64, portraitPattern(0)));
  assert.equal(same, result, 'an unchanged crop serves the exact stored verdict (identical result object)');
  assert.equal(cache.size, 1);
  assert.equal(cache.hitCount, 1);
  // Changed content in the SAME geometry: the signature must invalidate.
  assert.equal(cache.get(region, rect, grayImage(64, 64, portraitPattern(1))), null, 'a changed crop must never be served a stale match');
  assert.equal(cache.missCount, 2, 'initial miss + invalidation miss are counted');
  // Same content, DIFFERENT geometry (shifted crop): must also invalidate.
  assert.equal(cache.get(region, { x: 11, y: 20, w: 64, h: 64 }, grayImage(64, 64, portraitPattern(0))), null, 'a shifted crop must not reuse the previous geometry match');
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get(region, rect, grayImage(64, 64, portraitPattern(0))), null, 'clear() drops every entry');
});

test('buildSlotObservations memoises ban matches: unchanged crop skips the matcher, changed crop re-matches', () => {
  const profile = banSlotProfile();
  const matcher = countingMatcher([
    { heroId: 507, score: 0.9, abstained: false, candidates: [] },
    { heroId: 195, score: 0.85, abstained: false, candidates: [] },
  ]);
  const cache = new SlotMatchCache();
  const frameA = cacheTestFrame(0, null);
  const first = buildSlotObservations(frameA, profile, matcher, undefined, undefined, cache);
  assert.equal(matcher.callCount, 1, 'first frame matches the occupied ban slot');
  assert.equal(first[0].heroId, 507);
  assert.equal(first[0].estimated, true);
  const second = buildSlotObservations(frameA, profile, matcher, undefined, undefined, cache);
  assert.equal(matcher.callCount, 1, 'an unchanged ban crop is served from the cache, not re-matched');
  assert.deepEqual(second[0], first[0], 'the cached verdict produces the identical observation');
  // The ban icon changes: the cache must invalidate and the fresh verdict wins.
  const frameB = cacheTestFrame(1, null);
  const third = buildSlotObservations(frameB, profile, matcher, undefined, undefined, cache);
  assert.equal(matcher.callCount, 2, 'a changed ban crop invalidates the cache and re-matches');
  assert.equal(third[0].heroId, 195);
  assert.equal(third[0].estimated, true);
});

test('a ban slot that abstained keeps abstaining while its crop is unchanged', () => {
  const profile = banSlotProfile();
  const matcher = countingMatcher([{ heroId: null, score: 0.5, abstained: true, candidates: [] }]);
  const cache = new SlotMatchCache();
  const frame = cacheTestFrame(0, null);
  const first = buildSlotObservations(frame, profile, matcher, undefined, undefined, cache);
  assert.deepEqual(
    { heroId: first[0].heroId, score: first[0].score, abstained: first[0].abstained, estimated: first[0].estimated },
    { heroId: null, score: 0.5, abstained: true, estimated: undefined },
    'an abstaining ban stays abstained and un-estimated',
  );
  const second = buildSlotObservations(frame, profile, matcher, undefined, undefined, cache);
  assert.equal(matcher.callCount, 1, 'the abstention verdict itself is memoised for an unchanged crop');
  assert.equal(second[0].abstained, true, 'the cached abstention is served — the cache cannot weaken abstention');
});

test('unlocked picks are ALWAYS re-matched; locked picks are memoised', () => {
  const profile = banSlotProfile();
  const matcher = countingMatcher([{ heroId: 521, score: 0.8, abstained: false, candidates: [] }]);
  const cache = new SlotMatchCache();
  const frame = cacheTestFrame(null, 0);
  // Unlocked (pre-selection): matcher runs every frame, nothing is cached.
  buildSlotObservations(frame, profile, matcher, undefined, undefined, cache);
  buildSlotObservations(frame, profile, matcher, undefined, undefined, cache);
  assert.equal(matcher.callCount, 2, 'a pre-selection can change without a lock — never cached');
  assert.equal(cache.size, 0);
  // Latched lock: the committed portrait is static — memoised after the first match.
  const locked = buildSlotObservations(frame, profile, matcher, undefined, new Set([1]), cache);
  assert.equal(matcher.callCount, 3);
  assert.equal(locked[1].locked, true);
  buildSlotObservations(frame, profile, matcher, undefined, new Set([1]), cache);
  assert.equal(matcher.callCount, 3, 'a locked pick with an unchanged crop is served from the cache');
  assert.equal(cache.size, 1);
});

test('the pipeline resets the match cache on restart, on a changed ban crop, and on stop()', () => {
  const errors = [];
  const pipeline = new VisionPipeline({ heroes: [], side: 'red', manualLayout: defaultManualLayoutConfig(3), autoDetect: true }, { onError: message => errors.push(message) });
  Object.defineProperty(pipeline, 'capture', { value: { status: 'running', stop: () => {} } });
  const matcher = countingMatcher([{ heroId: 507, score: 0.9, abstained: false, candidates: [] }]);
  Object.defineProperty(pipeline, 'matcher', { value: matcher });
  const emptyPosition = { step: 0, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } };
  Object.defineProperty(pipeline, 'observer', { value: { ingest: () => ({ changed: false, position: emptyPosition }) } });

  // 1400x630 resolves the calibrated 2800x1260 profile (aspect 20:9); the two
  // ban strips carry high-contrast content (6 ban slots), everything else is
  // the flat placeholder. Bans get matched and cached; picks stay
  // blank/unlocked.
  const banBand = (x, y, variant) => {
    if (y >= 64) return 60;
    const inLeft = x >= 80 && x < 420;
    const inRight = x >= 1150 && x < 1320;
    if (!inLeft && !inRight) return 60;
    if (variant === 0) return ((x >> 2) + (y >> 2)) % 2 === 0 ? 40 : 215;
    return ((x >> 2) + (y >> 2)) % 2 === 0 ? 90 : 230;
  };
  const frameA = { gray: grayImage(1400, 630, (x, y) => banBand(x, y, 0)), width: 1400, height: 630, ts: 1000 };
  pipeline['handleFrame'](frameA);
  assert.equal(pipeline.matchCacheSize, 6, 'the 6 occupied ban slots are cached');
  assert.equal(matcher.callCount, 6);
  assert.equal(pipeline.matchCacheMissCount, 6, 'first frame: every ban slot is a cache miss');

  // Same ban content again: all served from the cache, the matcher is idle.
  pipeline['handleFrame']({ ...frameA, ts: 1333 });
  assert.equal(matcher.callCount, 6, 'unchanged ban crops never re-match');
  assert.equal(pipeline.matchCacheHitCount, 6);
  assert.equal(pipeline.matchCacheSize, 6);

  // The ban icons change (draft advances): the cache must invalidate and
  // re-match — never serve a stale identity.
  pipeline['handleFrame']({ gray: grayImage(1400, 630, (x, y) => banBand(x, y, 1)), width: 1400, height: 630, ts: 1666 });
  assert.equal(matcher.callCount, 12, 'changed ban crops invalidate the cache and re-match');
  assert.equal(pipeline.matchCacheSize, 6, 'the fresh verdicts are re-cached');

  // stop() is a capture restart: the cache must be empty afterwards.
  pipeline.stop();
  assert.equal(pipeline.matchCacheSize, 0, 'stop() clears the per-slot match cache');
  assert.equal(pipeline.matchCacheHitCount, 0, 'stop() resets the diagnostics too');
  assert.equal(pipeline.matchCacheMissCount, 0);
});

// ---------------------------------------------------------------------------