// Vision pipeline orchestration tests: coordinate scaling, blank-slot heuristic,
// and slot-observation building. These exercise the pure helpers in
// src/vision/pipeline.ts without requiring a browser DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  scaleRect,
  isBlankSlot,
  BLANK_SLOT_STD_THRESHOLD,
  buildSlotObservations,
  sortSlotsChronologically,
  detectLeftColumnSide,
  sideCrossCheck,
  VisionPipeline,
} from '../src/vision/pipeline.ts';
import { resolveSlotSides } from '../src/vision/regionMap.ts';
import { buildManualRegionProfile, defaultManualLayoutConfig } from '../src/vision/manualLayout.ts';
import {
  positionIsPrefix,
  visionFormatMismatchReason,
  formatLayoutSourceMessage,
  formatSideCheckWarning,
  getSlotOverlayLabel,
  isLowConfidenceLayout,
  hasNoContentNotes,
  mapObservationToTeamSlots,
  VisionDetectedBoard,
  estimateOverlayMetrics,
  planOverlayLabel,
} from '../src/components/VisionPanel.tsx';
import { getDraftSequence } from '../src/engine/draftRules.ts';
import { resolvePortraitUrl } from '../src/vision/referenceSet.ts';
import { unidentifiedBansBreakdownMessage } from '../src/vision/observer.ts';

function grayImage(width, height, fill) {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    data[i] = fill(x, y, i);
  }
  return { width, height, data };
}

test('scaleRect maps device-native rects to capture-space proportionally', () => {
  const rect = { x: 100, y: 200, w: 300, h: 400 };
  const scaled = scaleRect(rect, 2400, 1080, 1200, 540);
  assert.deepEqual(scaled, { x: 50, y: 100, w: 150, h: 200 });

  // Non-integer results are preserved (caller crops with floor/ceil).
  const odd = scaleRect({ x: 1, y: 1, w: 1, h: 1 }, 3, 3, 2, 2);
  assert.deepEqual(odd, { x: 2 / 3, y: 2 / 3, w: 2 / 3, h: 2 / 3 });
});

test('scaleRect returns a zero rect when source or target dimensions are invalid', () => {
  const rect = { x: 10, y: 10, w: 20, h: 20 };
  assert.deepEqual(scaleRect(rect, 0, 1080, 1200, 540), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(scaleRect(rect, 2400, 0, 1200, 540), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(scaleRect(rect, 2400, 1080, 0, 540), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(scaleRect(rect, 2400, 1080, 1200, 0), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(scaleRect(rect, -100, 1080, 1200, 540), { x: 0, y: 0, w: 0, h: 0 });
});

test('isBlankSlot classifies low-variance crops as empty and high-variance crops as occupied', () => {
  const flat = grayImage(32, 32, () => 60);
  assert.equal(isBlankSlot(flat), true, 'uniform crop is blank');

  // Occupied fixtures sit clearly above the measured 30.0 threshold
  // (checkerboard: std = amplitude/2; smooth mix: std ~= amplitude*0.7).
  const noisy = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 80);
  assert.equal(isBlankSlot(noisy), false, 'high-contrast checkerboard crop is not blank');

  const portraitLike = grayImage(32, 32, (x, y) => 30 + Math.sin(x / 4) * 60 + Math.cos(y / 4) * 60);
  assert.equal(isBlankSlot(portraitLike), false, 'smooth portrait-like crop is not blank');
});

test('isBlankSlot classifies the measured placeholder-crop shapes as empty', () => {
  // Corpus-measured empty placeholders: flat team tint + a small grey helmet
  // glyph measure std 8.3–26.8 (see BLANK_SLOT_STD_THRESHOLD doc). A flat tint
  // with a small darker glyph reproduces that: ~5% of pixels at -40 gray
  // levels -> std ~9.1, well below the threshold.
  const tint = 60;
  const glyphValue = 20;
  const withGlyph = grayImage(147, 147, (x, y) => {
    const inGlyph = x >= 55 && x < 90 && y >= 40 && y < 95 && (Math.abs(x - 72) < 12 || (y > 55 && y < 80 && Math.abs(x - 72) < 20));
    return inGlyph ? glyphValue : tint;
  });
  assert.equal(isBlankSlot(withGlyph), true, 'flat tint + small glyph (std ~9) is blank');

  // The highlighted "your turn" variant reaches the measured empty max ~26.8;
  // it must stay blank, while the lightest occupied crop (~31) must not.
  const twoLevelEmpty = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 27); // std 13.5
  assert.equal(isBlankSlot(twoLevelEmpty), true);
  const boundaryEmpty = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 53); // std 26.5
  assert.equal(isBlankSlot(boundaryEmpty), true, 'measured empty max (std 26.8) stays blank');
  const lightestOccupied = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 63); // std 31.5
  assert.equal(isBlankSlot(lightestOccupied), false, 'lightest occupied crop (std 31) is not blank');
});

test('isBlankSlot uses the documented threshold as a conservative boundary', () => {
  // For a perfect two-level image, std equals half the intensity difference.
  // Measured clusters: empty max std 26.8, occupied min std 31.0, threshold 30.
  const below = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 55); // std 27.5 < 30
  assert.equal(isBlankSlot(below), true);

  const above = grayImage(32, 32, (x, y) => 60 + ((x + y) % 2) * 65); // std 32.5 > 30
  assert.equal(isBlankSlot(above), false);
});

test('buildSlotObservations emits one observation per region and preserves empty/abstained semantics', () => {
  const frame = {
    gray: grayImage(100, 100, (x, y) => {
      // Region 0 (0,0,20,20) is intentionally uniform/blank.
      if (x < 20 && y < 20) return 60;
      return 60 + ((x + y) % 2) * 80;
    }),
    width: 100,
    height: 100,
  };
  const profile = {
    version: 'test',
    resolution: { width: 100, height: 100 },
    slots: [
      { index: 0, rect: { x: 0, y: 0, w: 20, h: 20 }, side: 'blue', kind: 'ban' },
      { index: 1, rect: { x: 20, y: 0, w: 20, h: 20 }, side: 'blue', kind: 'ban' },
      { index: 0, rect: { x: 0, y: 20, w: 20, h: 20 }, side: 'red', kind: 'pick' },
    ],
    anchors: [],
  };

  let callCount = 0;
  const matcher = {
    referenceCount: 3,
    match(crop, options) {
      callCount += 1;
      // First two calls: blank slot gets skipped (matcher not called).
      // Actually the first slot is blank because cropStd of a 20x20 uniform region is 0.
      if (callCount === 1) return { heroId: 101, score: 0.92, abstained: false, candidates: [] };
      if (callCount === 2) return { heroId: null, score: 0.31, abstained: true, candidates: [] };
      return { heroId: null, score: 0, abstained: true, candidates: [] };
    },
  };

  const observations = buildSlotObservations(frame, profile, matcher);
  assert.equal(observations.length, 3);

  const [empty, identified, unrecognized] = observations;
  assert.deepEqual(empty, { index: 0, side: 'blue', kind: 'ban', heroId: null, score: 0, abstained: false });
  // A ban identification is an estimate, never a fact: vision-produced ban
  // identities carry `estimated: true` (see SlotObservation.estimated).
  assert.deepEqual(identified, { index: 1, side: 'blue', kind: 'ban', heroId: 101, score: 0.92, abstained: false, estimated: true });
  assert.deepEqual(unrecognized, { index: 0, side: 'red', kind: 'pick', heroId: null, score: 0.31, abstained: true, locked: false });
});

test('VisionPipeline reports unsupported in Node and starts without throwing', async () => {
  assert.equal(VisionPipeline.isSupported(), false);
  const pipeline = new VisionPipeline({ heroes: [], side: 'blue' });
  assert.equal(pipeline.status, 'idle');
  await pipeline.start();
  assert.equal(pipeline.status, 'error');
  pipeline.stop();
});

test('positionIsPrefix detects prefix, equality, and divergence between draft positions', () => {
  const empty = { step: 0, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } };
  const oneBlueBan = { step: 1, picks: { blue: [], red: [] }, bans: { blue: [101], red: [] } };
  const twoBans = { step: 2, picks: { blue: [], red: [] }, bans: { blue: [101], red: [102] } };
  const diverged = { step: 1, picks: { blue: [], red: [] }, bans: { blue: [999], red: [] } };

  assert.equal(positionIsPrefix(empty, oneBlueBan), true);
  assert.equal(positionIsPrefix(oneBlueBan, twoBans), true);
  assert.equal(positionIsPrefix(twoBans, twoBans), true);
  assert.equal(positionIsPrefix(oneBlueBan, empty), false, 'current step ahead of detected');
  assert.equal(positionIsPrefix(oneBlueBan, diverged), false, 'same step but different hero');

  // Partial overlap: current step is behind but existing actions do not match.
  const partialCurrent = { step: 1, picks: { blue: [], red: [] }, bans: { blue: [101], red: [] } };
  const partialDetected = { step: 2, picks: { blue: [], red: [] }, bans: { blue: [101, 999], red: [] } };
  assert.equal(positionIsPrefix(partialCurrent, partialDetected), true);

  const mismatchDetected = { step: 2, picks: { blue: [], red: [] }, bans: { blue: [555, 999], red: [] } };
  assert.equal(positionIsPrefix(partialCurrent, mismatchDetected), false);
});

test('resolvePortraitUrl uses the published portrait_asset when present', () => {
  const webp = { hero_id: 112, portrait_asset: '/assets/heroes/112.webp' };
  assert.equal(resolvePortraitUrl(webp), '/assets/heroes/112.webp');
  assert.equal(resolvePortraitUrl(webp, 'https://example.com/base'), 'https://example.com/base/assets/heroes/112.webp');

  // A root-relative asset is joined onto the base; a full URL is kept as-is.
  assert.equal(resolvePortraitUrl({ hero_id: 1, portrait_asset: 'assets/heroes/1.webp' }, 'https://x'), 'assets/heroes/1.webp');
  assert.equal(resolvePortraitUrl({ hero_id: 1, portrait_asset: 'https://cdn.example/1.webp' }), 'https://cdn.example/1.webp');

  // Blank/whitespace portrait_asset falls through to the default convention.
  assert.equal(resolvePortraitUrl({ hero_id: 105, portrait_asset: '   ' }), '/assets/heroes/105.webp');
});

test('resolvePortraitUrl falls back to /assets/heroes/{id}.webp when portrait_asset is missing', () => {
  assert.equal(resolvePortraitUrl({ hero_id: 112 }), '/assets/heroes/112.webp');
  assert.equal(resolvePortraitUrl({ hero_id: 112, portrait_asset: undefined }, 'https://example.com/app'), 'https://example.com/app/assets/heroes/112.webp');
});

test('resolvePortraitUrl keeps the .jpg extension for CN-exclusive portraits instead of assuming .webp', () => {
  const changE = { hero_id: 515, portrait_asset: '/assets/heroes/515.jpg' };
  assert.equal(resolvePortraitUrl(changE), '/assets/heroes/515.jpg');
  assert.equal(resolvePortraitUrl(changE, 'https://example.com'), 'https://example.com/assets/heroes/515.jpg');
  assert.equal(resolvePortraitUrl({ hero_id: 525, portrait_asset: '/assets/heroes/525.jpg' }), '/assets/heroes/525.jpg');
});

test('visionFormatMismatchReason names the required simulator mode and the "Format draft" control', () => {
  const message = visionFormatMismatchReason('ranked');
  assert.match(message, /Simulator harus berada di mode Ranked/);
  assert.match(message, /"Format draft"/);
  assert.match(message, /"Ranked"/);

  const tournamentMessage = visionFormatMismatchReason('tournament');
  assert.match(tournamentMessage, /mode Turnamen/);
  assert.match(tournamentMessage, /"Turnamen"/);
});

test('ranked and tournament sequences have different lengths, so the advisor format must be guarded before any step comparison', () => {
  assert.equal(getDraftSequence('ranked').length, 16);
  assert.equal(getDraftSequence('tournament').length, 18);
  assert.notEqual(getDraftSequence('ranked').length, getDraftSequence('tournament').length);
});

// ---------------------------------------------------------------------------
// Chronological slot ordering (pipeline -> observer contract)
// ---------------------------------------------------------------------------

const slotObs = (index, side, kind, heroId, abstained = false) => ({ index, side, kind, heroId, abstained });

test('sortSlotsChronologically orders occupied slots by first-fill time and puts empty slots last', () => {
  // Ranked reality: UI row 2 (index 1) filled BEFORE UI row 1 (index 0).
  const slots = [
    slotObs(0, 'red', 'pick', 521),   // filled LATER (UI row 1)
    slotObs(1, 'red', 'pick', 177),   // filled FIRST (UI row 2)
    slotObs(2, 'red', 'pick', null),  // still empty
  ];
  const firstFilledAt = new Map([[0, 5000], [1, 3000]]);
  const sorted = sortSlotsChronologically(slots, firstFilledAt);
  assert.deepEqual(sorted.map(s => s.index), [1, 0, 2]);
});

test('sortSlotsChronologically treats an abstained (occupied but unidentified) slot as occupied', () => {
  const slots = [
    slotObs(0, 'red', 'pick', null, true), // occupied but unidentified, ts 4000
    slotObs(1, 'red', 'pick', 177),        // ts 3000
    slotObs(2, 'red', 'pick', null),       // visibly empty
  ];
  const sorted = sortSlotsChronologically(slots, new Map([[0, 4000], [1, 3000]]));
  assert.deepEqual(sorted.map(s => s.index), [1, 0, 2]);
});

test('sortSlotsChronologically keeps slots without a fill timestamp after the timed ones', () => {
  const slots = [slotObs(0, 'blue', 'pick', 114), slotObs(1, 'blue', 'pick', 156)];
  const sorted = sortSlotsChronologically(slots, new Map()); // nothing tracked yet
  assert.deepEqual(sorted.map(s => s.index), [0, 1], 'no timestamps -> stable array order');
});

test('sortSlotsChronologically sorts per (side, kind) group and preserves group positions and multiplicity', () => {
  const slots = [
    slotObs(0, 'red', 'pick', null),
    slotObs(10, 'red', 'ban', 507),   // ban filled late
    slotObs(1, 'red', 'pick', 177),   // pick filled early
    slotObs(11, 'red', 'ban', null),
    slotObs(2, 'red', 'pick', 121),   // pick filled later than 177
  ];
  const firstFilledAt = new Map([[1, 1000], [2, 2000], [10, 9000]]);
  const sorted = sortSlotsChronologically(slots, firstFilledAt);
  // red pick group: [177, 121, null]; red ban group: [507, null]; the red pick
  // group stays at the front because it first appeared there.
  assert.deepEqual(sorted.map(s => s.index), [1, 2, 0, 10, 11]);
  assert.equal(sorted.length, slots.length, 'one observation per region slot is preserved');
});

test('sortSlotsChronologically reflects the corrected position when a slot fills later', () => {
  // Observation A: index 0 filled, index 1 empty.
  const obsA = [slotObs(0, 'red', 'pick', 177), slotObs(1, 'red', 'pick', null)];
  const firstFilledAt = new Map([[0, 1000]]);
  assert.deepEqual(sortSlotsChronologically(obsA, firstFilledAt).map(s => s.index), [0, 1]);
  // Observation B: index 1 has now filled too; a LATER fill must rank after.
  const obsB = [slotObs(0, 'red', 'pick', 177), slotObs(1, 'red', 'pick', 521)];
  firstFilledAt.set(1, 3000);
  assert.deepEqual(sortSlotsChronologically(obsB, firstFilledAt).map(s => s.index), [0, 1]);
  firstFilledAt.set(1, 500); // index 1 actually filled FIRST (UI row 2 case)
  assert.deepEqual(sortSlotsChronologically(obsB, firstFilledAt).map(s => s.index), [1, 0]);
});

// ---------------------------------------------------------------------------
// Side mirroring (ownSide semantics)
// ---------------------------------------------------------------------------

const calibratedProfile = buildManualRegionProfile(defaultManualLayoutConfig(3), 2800, 1260);

test('resolveSlotSides: operator on the profile ownSide (red) keeps every side unchanged', () => {
  const resolved = resolveSlotSides(calibratedProfile, 'red');
  assert.deepEqual(resolved.map(s => s.side), calibratedProfile.slots.map(s => s.side));
  assert.deepEqual(resolved.map(s => s.rect), calibratedProfile.slots.map(s => s.rect), 'geometry untouched');
  assert.notEqual(resolved[0], calibratedProfile.slots[0], 'returns copies, never the frozen profile slots');
});

test('resolveSlotSides: operator on blue mirrors the absolute sides but keeps the geometry', () => {
  const resolved = resolveSlotSides(calibratedProfile, 'blue');
  const expected = calibratedProfile.slots.map(s => (s.side === 'red' ? 'blue' : 'red'));
  assert.deepEqual(resolved.map(s => s.side), expected);
  assert.deepEqual(resolved.map(s => s.rect), calibratedProfile.slots.map(s => s.rect));
  assert.deepEqual(resolved.map(s => s.kind), calibratedProfile.slots.map(s => s.kind));
  assert.deepEqual(resolved.map(s => s.index), calibratedProfile.slots.map(s => s.index));
});

test('resolveSlotSides defaults ownSide to red when the profile omits it', () => {
  const bare = { version: 'bare', resolution: { width: 100, height: 100 }, slots: [{ index: 0, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 10, h: 10 } }], anchors: [] };
  assert.deepEqual(resolveSlotSides(bare, 'red')[0].side, 'red');
  assert.deepEqual(resolveSlotSides(bare, 'blue')[0].side, 'blue');
});

// ---------------------------------------------------------------------------
// Colour-side cross-check (tint of the own-team column)
// ---------------------------------------------------------------------------

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

test('detectLeftColumnSide reads the measured dim tile tints: red warm, blue cool, grey unknown', () => {
  // The corpus-measured placeholder tints: red ~(63,23,33), blue ~(9,36,66).
  const redTile = rgbaPlane(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [63, 23, 33] : [24, 26, 34]));
  assert.equal(detectLeftColumnSide(redTile, [{ x: 10, y: 10, w: 20, h: 20 }]), 'red');

  const blueTile = rgbaPlane(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [9, 36, 66] : [24, 26, 34]));
  assert.equal(detectLeftColumnSide(blueTile, [{ x: 10, y: 10, w: 20, h: 20 }]), 'blue');

  const grey = rgbaPlane(40, 40, () => [80, 80, 80]);
  assert.equal(detectLeftColumnSide(grey, [{ x: 0, y: 0, w: 40, h: 40 }]), 'unknown', 'no chromatic pixels -> unknown');
});

test('detectLeftColumnSide ignores cool scene background outside the sampled tile rects', () => {
  // Dark-navy background everywhere, red tile interior in rect B only; the
  // result must come from rect B (red), not from the background.
  const frame = rgbaPlane(100, 100, (x, y) => (x >= 60 && y >= 60 ? [63, 23, 33] : [24, 26, 34]));
  assert.equal(detectLeftColumnSide(frame, [{ x: 60, y: 60, w: 30, h: 30 }]), 'red');
  // Without the tile rect the background alone cannot decide.
  assert.equal(detectLeftColumnSide(frame, [{ x: 0, y: 0, w: 30, h: 30 }]), 'unknown');
});

test('sideCrossCheck flags a confident mismatch and stays silent on unknown', () => {
  assert.deepEqual(sideCrossCheck('blue', 'red', 42), { detected: 'blue', declared: 'red', mismatch: true, checkedAt: 42 });
  assert.deepEqual(sideCrossCheck('red', 'red', 42).mismatch, false);
  assert.deepEqual(sideCrossCheck('unknown', 'red', 42).mismatch, false, 'unknown never overrides the operator');
});

// ---------------------------------------------------------------------------
// Vision panel copy & overlay helpers
// ---------------------------------------------------------------------------

test('formatLayoutSourceMessage returns Indonesian copy for every layout source', () => {
  assert.match(formatLayoutSourceMessage('manual'), /tata letak manual/);
  assert.match(formatLayoutSourceMessage('none'), /bukan draft/);
});

test('hasNoContentNotes recognises notes that describe a blank or powered-off shared surface', () => {
  assert.equal(hasNoContentNotes(['Layar yang dibagikan tampak kosong atau mati']), true);
  assert.equal(hasNoContentNotes(['Layar hitam, tidak ada konten']), true);
  assert.equal(hasNoContentNotes(['Layar mati / screen off']), true);
  assert.equal(hasNoContentNotes(['Tidak ada gambar di layar yang dibagikan']), true);
  assert.equal(hasNoContentNotes(['kolom kanan diekstrapolasi dari simetri cermin']), false);
  assert.equal(hasNoContentNotes(['Tile candidates: 12']), false);
  assert.equal(hasNoContentNotes([]), false);
});

test('formatSideCheckWarning only warns on a confident mismatch and never switches the declared side', () => {
  assert.equal(formatSideCheckWarning({ detected: 'unknown', declared: 'blue', mismatch: false, checkedAt: 0 }), null);
  assert.equal(formatSideCheckWarning({ detected: 'blue', declared: 'blue', mismatch: false, checkedAt: 0 }), null);
  const mismatchRed = formatSideCheckWarning({ detected: 'red', declared: 'blue', mismatch: true, checkedAt: 0 });
  assert.match(mismatchRed, /merah/);
  assert.match(mismatchRed, /memilih biru/);
  const mismatchBlue = formatSideCheckWarning({ detected: 'blue', declared: 'red', mismatch: true, checkedAt: 0 });
  assert.match(mismatchBlue, /biru/);
  assert.match(mismatchBlue, /memilih merah/);
});

test('getSlotOverlayLabel prefixes picks with B/R and bans with compact bB/bR', () => {
  // Left-column picks: index 0..4 -> B1..B5 (assuming side blue after mirroring).
  assert.equal(getSlotOverlayLabel({ index: 0, side: 'blue', kind: 'pick', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'B1');
  assert.equal(getSlotOverlayLabel({ index: 4, side: 'blue', kind: 'pick', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'B5');
  assert.equal(getSlotOverlayLabel({ index: 5, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'R1');
  assert.equal(getSlotOverlayLabel({ index: 9, side: 'red', kind: 'pick', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'R5');
  // Bans use a compact prefix so consecutive labels do not collide on 64 px icons.
  assert.equal(getSlotOverlayLabel({ index: 10, side: 'blue', kind: 'ban', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'bB1');
  assert.equal(getSlotOverlayLabel({ index: 12, side: 'blue', kind: 'ban', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'bB3');
  assert.equal(getSlotOverlayLabel({ index: 13, side: 'red', kind: 'ban', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'bR1');
  assert.equal(getSlotOverlayLabel({ index: 15, side: 'red', kind: 'ban', rect: { x: 0, y: 0, w: 10, h: 10 } }), 'bR3');
});

test('planOverlayLabel sizes labels from the box and display scale, fitting ban slots within their pitch', () => {
  const banSlot = { index: 10, side: 'blue', kind: 'ban', rect: { x: 0, y: 0, w: 64, h: 64 } };
  const pickSlot = { index: 0, side: 'blue', kind: 'pick', rect: { x: 0, y: 0, w: 147, h: 147 } };

  const banLabel = getSlotOverlayLabel(banSlot);
  const pickLabel = getSlotOverlayLabel(pickSlot);
  assert.equal(banLabel, 'bB1');
  assert.equal(pickLabel, 'B1');
  assert.ok(banLabel.length < 'ban B1'.length, 'ban label is shorter than the old verbose form');

  // A 64×64 ban icon shown in a panel that scales the 1920-wide canvas down to ~800 px.
  const displayScale = 800 / 1920;
  const banMetrics = estimateOverlayMetrics(banLabel);
  const banPlan = planOverlayLabel(banSlot, 64, 64, displayScale, banMetrics);
  assert.equal(banPlan.text, banLabel);
  assert.notEqual(banPlan.placement, 'omit', 'ban label must not be omitted');
  assert.ok(banPlan.fontSize > 0, 'ban font size is positive');

  // The rendered label must fit inside the 64 px box and the ~86 px pitch between ban icons.
  const renderedWidthCss = banPlan.fontSize * banMetrics.widthPerPx * displayScale;
  assert.ok(renderedWidthCss <= 64 * displayScale, 'ban label fits its 64 px box on screen');
  assert.ok(renderedWidthCss <= 86 * displayScale, 'ban label fits the ~86 px pitch between icons');

  // Font size grows with box size: a large pick slot gets a larger drawn size.
  const pickMetrics = estimateOverlayMetrics(pickLabel);
  const pickPlan = planOverlayLabel(pickSlot, 147, 147, displayScale, pickMetrics);
  assert.ok(pickPlan.fontSize > banPlan.fontSize, 'larger box gets a larger canvas font size');

  // A tiny box that cannot fit the label inside omits it instead of colliding.
  const tinyPlan = planOverlayLabel(banSlot, 14, 14, displayScale, banMetrics);
  assert.equal(tinyPlan.placement, 'omit');
});

test('isLowConfidenceLayout is always false in manual-only mode', () => {
  assert.equal(isLowConfidenceLayout(null, 'manual'), false);
  assert.equal(isLowConfidenceLayout(0.5, 'manual'), false);
  assert.equal(isLowConfidenceLayout(null, 'none'), false);
});

test('mapObservationToTeamSlots maps region-profile indexes to display order per side and kind', () => {
  const observation = {
    ts: 0,
    screen: 'draft',
    side: 'blue',
    slots: [
      { index: 5, side: 'red', kind: 'pick', heroId: 101, score: 0.9, abstained: false },
      { index: 9, side: 'red', kind: 'pick', heroId: 102, score: 0.85, abstained: false },
      { index: 13, side: 'red', kind: 'ban', heroId: null, score: 0.4, abstained: true },
      { index: 15, side: 'red', kind: 'ban', heroId: 103, score: 0.8, abstained: false },
      { index: 0, side: 'blue', kind: 'pick', heroId: 201, score: 0.9, abstained: false },
      { index: 10, side: 'blue', kind: 'ban', heroId: null, score: 0.3, abstained: true },
    ],
  };
  const heroes = [
    { hero_id: 101, name: 'A' },
    { hero_id: 102, name: 'B' },
    { hero_id: 103, name: 'C' },
    { hero_id: 201, name: 'D' },
  ];
  const teams = mapObservationToTeamSlots(observation, heroes, 'ranked');
  assert.equal(teams.red.picks[0].hero?.hero_id, 101);
  assert.equal(teams.red.picks[1].hero?.hero_id, 102, 'red pick index 9 maps to display index 1');
  assert.equal(teams.red.picks[4].empty, true);
  assert.equal(teams.red.bans[0].abstained, true, 'red ban index 13 maps to display index 0');
  assert.equal(teams.red.bans[1].hero?.hero_id, 103, 'red ban index 15 maps to display index 1');
  assert.equal(teams.blue.picks[0].hero?.hero_id, 201);
  assert.equal(teams.blue.bans[0].abstained, true, 'blue ban index 10 maps to display index 0');
});

test('mapObservationToTeamSlots treats only locked=true picks as committed and locked=false/undefined as preselected', () => {
  const heroes = [{ hero_id: 101, name: 'Locked' }, { hero_id: 102, name: 'Unlocked' }, { hero_id: 103, name: 'UnknownLock' }];
  const observation = {
    ts: 0,
    screen: 'draft',
    side: 'red',
    slots: [
      { index: 0, side: 'red', kind: 'pick', heroId: 101, score: 0.9, abstained: false, locked: true },
      { index: 1, side: 'red', kind: 'pick', heroId: 102, score: 0.85, abstained: false, locked: false },
      { index: 2, side: 'red', kind: 'pick', heroId: 103, score: 0.8, abstained: false },
    ],
  };
  const teams = mapObservationToTeamSlots(observation, heroes, 'ranked');
  assert.equal(teams.red.picks[0].locked, true, 'explicit lock marker is committed');
  assert.equal(teams.red.picks[1].locked, false, 'explicit unlock marker is preselected');
  assert.equal(teams.red.picks[2].locked, false, 'missing lock marker defaults to not committed');
});

test('mapObservationToTeamSlots marks every ban identity as an estimate and honours an explicit unverified marker', () => {
  const heroes = [{ hero_id: 101, name: 'Ying' }, { hero_id: 102, name: 'XuanCe' }];
  const observation = {
    ts: 0,
    screen: 'draft',
    side: 'red',
    slots: [
      { index: 10, side: 'red', kind: 'ban', heroId: 101, score: 0.78, abstained: false },
      { index: 11, side: 'red', kind: 'ban', heroId: 102, score: 0.81, abstained: false, estimated: true },
      { index: 12, side: 'red', kind: 'ban', heroId: null, score: 0.4, abstained: true },
    ],
  };
  const teams = mapObservationToTeamSlots(observation, heroes, 'ranked');
  assert.equal(teams.red.bans[0].estimated, true, 'ban with hero defaults to estimate');
  assert.equal(teams.red.bans[1].estimated, true, 'explicit estimated=true marker is honoured');
  assert.equal(teams.red.bans[2].estimated, undefined, 'abstained ban has no estimate flag');
});

test('VisionDetectedBoard renders preselected picks with dashed styling and a visible "Pilih Dulu" note', () => {
  const heroes = [{ hero_id: 101, name: 'Kui' }];
  const slotsByTeam = {
    blue: { bans: [], picks: [] },
    red: {
      bans: [],
      picks: [
        { hero: heroes[0], score: 0.69, abstained: false, empty: false, locked: false },
      ],
    },
  };
  const html = renderToStaticMarkup(React.createElement(VisionDetectedBoard, {
    slotsByTeam,
    ownSide: 'red',
    advisorIsUltimateBattle: false,
  }));
  assert.ok(html.includes('is-preselected'), 'preselected slot carries the preselected class');
  assert.ok(html.includes('Pilih Dulu'), 'preselected slot shows the game label');
  assert.ok(html.includes('bisa berubah'), 'preselected slot states it can still change');
  assert.ok(html.includes('pra-pilih, belum terkunci, masih bisa berubah'), 'aria-label warns the slot is not committed');
  assert.ok(!html.includes('is-filled'), 'preselected slot must not use the filled pick class');
});

test('VisionDetectedBoard renders committed picks as filled and ban identities as estimates', () => {
  const heroes = [{ hero_id: 101, name: 'Haya' }, { hero_id: 102, name: 'Ying' }];
  const slotsByTeam = {
    blue: { bans: [], picks: [] },
    red: {
      bans: [{ hero: heroes[1], score: 0.78, abstained: false, empty: false, estimated: true }],
      picks: [{ hero: heroes[0], score: 0.57, abstained: false, empty: false, locked: true }],
    },
  };
  const html = renderToStaticMarkup(React.createElement(VisionDetectedBoard, {
    slotsByTeam,
    ownSide: 'red',
    advisorIsUltimateBattle: false,
  }));
  assert.ok(html.includes('is-filled'), 'committed pick carries the filled class');
  assert.ok(html.includes('perkiraan'), 'ban identity shows the estimate chip');
  assert.ok(html.includes('is-estimated'), 'ban identity carries the estimated class');
  assert.ok(html.includes('(perkiraan, bisa salah)'), 'ban aria-label warns it is a guess');
  assert.ok(!html.includes('78%'), 'ban estimate does not display a loud confidence score');
});

// ---------------------------------------------------------------------------
// Unidentified-ban notice copy: abstained vs estimated reported separately
// ---------------------------------------------------------------------------

test('the unidentified-bans notice copy states estimates and abstentions distinctly (never a bare total)', () => {
  // The notice is rendered from the observer result breakdown fields when
  // lastResult.unidentifiedBans > 0; these pin the exact rendered strings.
  const mixed = unidentifiedBansBreakdownMessage({ estimatedBans: 4, abstainedBans: 2 });
  assert.equal(mixed, '4 ban teridentifikasi (perkiraan) · 2 ban tidak teridentifikasi — semua ban tetap di luar posisi draft');
  assert.match(mixed, /perkiraan/, 'identified bans are labelled estimates, not facts');
  assert.match(mixed, /tidak teridentifikasi/, 'abstained bans are reported as unidentified');
  assert.match(mixed, /semua ban tetap di luar posisi draft/, 'the notice states no ban identity enters the position');

  // All abstained: no names to show, so no "perkiraan" fragment appears.
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 0, abstainedBans: 3 }),
    '3 ban tidak teridentifikasi — semua ban tetap di luar posisi draft',
  );
  // All estimated-but-identified: the "perkiraan" qualifier is mandatory.
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 3, abstainedBans: 0 }),
    '3 ban teridentifikasi (perkiraan) — semua ban tetap di luar posisi draft',
  );
});
