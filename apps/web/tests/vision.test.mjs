// Vision layer tests. NOTE: algorithm tests use synthetic GrayImages only —
// Node has no built-in .webp decoder, so real portrait decoding is exercised in
// the browser; here referenceSet.ts / capture.ts are checked for import-safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toGray,
  toCbCr,
  resizeGray,
  cropGray,
  normalizeGray,
  aspectFit,
  dHash,
  hammingDistance,
  ncc,
} from '../src/vision/geometry.ts';
import { HeroMatcher } from '../src/vision/heroMatcher.ts';
import { resolveSlotSides } from '../src/vision/regionMap.ts';
import { buildManualRegionProfile, defaultManualLayoutConfig } from '../src/vision/manualLayout.ts';

function gray(w, h, fill) {
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = fill(Math.floor(i % w), Math.floor(i / w), i);
  return { width: w, height: h, data };
}

function pseudoRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('every GrayImage producer emits Float32Array data of exactly width*height samples', () => {
  const img = gray(6, 5, (x, y) => x * 10 + y);
  const producers = [
    toGray({ width: 3, height: 2, data: new Uint8ClampedArray(24).fill(128) }), // ImageData.data IS Uint8ClampedArray — intentional input shape
    resizeGray(img, 4, 7),
    cropGray(img, { x: 1, y: 1, w: 3, h: 2 }),
    normalizeGray(img),
    aspectFit(img, 8, 8),
  ];
  for (const produced of producers) {
    assert.ok(produced.data instanceof Float32Array, 'data must be Float32Array');
    assert.equal(produced.data.length, produced.width * produced.height);
  }
});

test('toGray converts luminance; resize/crop preserve basic invariants and clamp', () => {
  // ImageData is a DOM type; in Node we pass a structurally identical plain object.
  const rgba = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]),
  };
  const g = toGray(rgba);
  assert.equal(g.width, 2);
  assert.equal(g.height, 2);
  assert.equal(g.data.length, 4);
  assert.equal(g.data[0], 76); // round(0.299*255)
  assert.equal(g.data[1], 150); // round(0.587*255)
  assert.equal(g.data[2], 29); // round(0.114*255)
  assert.equal(g.data[3], 255);

  const img = gray(4, 4, (x, y) => y * 4 + x);
  assert.deepEqual(Array.from(resizeGray(img, 4, 4).data), Array.from(img.data));
  const up = resizeGray(img, 8, 8);
  assert.equal(up.width, 8);
  assert.equal(up.data.length, 64);
  assert.deepEqual(Array.from(cropGray(img, { x: 1, y: 1, w: 2, h: 2 }).data), [5, 6, 9, 10]);
  const clamped = cropGray(img, { x: -2, y: -2, w: 6, h: 6 });
  assert.equal(clamped.width, 4);
  assert.equal(clamped.height, 4);
  assert.equal(clamped.data.length, 16);
  const outside = cropGray(img, { x: 10, y: 10, w: 4, h: 4 });
  assert.equal(outside.width, 0);
  assert.equal(outside.data.length, 0);

  // aspectFit letterboxes onto a zero background, centered.
  const tall = gray(2, 4, (x, y) => y);
  const fitted = aspectFit(tall, 4, 4);
  assert.equal(fitted.width, 4);
  assert.deepEqual(Array.from(fitted.data), [0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 3, 3, 0]);
});

test('dHash is deterministic with a documented bit layout; hammingDistance counts crafted differences', () => {
  // Left half bright, right half dark -> bit (y*8+3) set for every row.
  const pattern = gray(9, 8, x => (x < 4 ? 255 : 0));
  let expected = 0n;
  for (let y = 0; y < 8; y++) expected |= 1n << BigInt(y * 8 + 3);
  assert.equal(dHash(pattern), expected);
  assert.equal(dHash(pattern), dHash(pattern));

  const inverted = gray(9, 8, x => (x < 4 ? 0 : 255)); // no bright->dark transitions remain -> empty hash
  assert.equal(dHash(inverted), 0n);
  assert.equal(hammingDistance(dHash(pattern), dHash(inverted)), 8);
  // A monotone staircase sets every bit; its inversion clears every bit.
  const staircase = gray(9, 8, x => 8 - x);
  assert.equal(dHash(staircase), (1n << 64n) - 1n);
  assert.equal(hammingDistance(dHash(staircase), dHash(gray(9, 8, x => x))), 64);
  assert.equal(hammingDistance(0n, 0n), 0);
  assert.equal(hammingDistance((1n << 64n) - 1n, 0n), 64);
  assert.equal(hammingDistance(0b1011n, 0b0110n), 3);
});

test('ncc is 1 for identical, -1 for inverted, and 0 for degenerate or mismatched input', () => {
  const a = gray(16, 16, (x, y) => (x * 7 + y * 13) % 256);
  const b = gray(16, 16, (x, y) => 255 - ((x * 7 + y * 13) % 256));
  assert.ok(Math.abs(ncc(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(ncc(a, b) + 1) < 1e-6);
  const flat = gray(16, 16, () => 128);
  assert.equal(ncc(a, flat), 0);
  assert.equal(ncc(flat, flat), 0);
  assert.equal(ncc(gray(4, 4, () => 1), gray(8, 8, () => 1)), 0);
});

test('normalizeGray produces zero mean and unit variance; constant input maps to zeros', () => {
  const normalized = normalizeGray(gray(16, 16, (x, y) => (x * 3 + y * 11 + 37) % 256));
  const values = Array.from(normalized.data);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  // Float32 storage rounds normalized values (~7 significant digits), so a
  // 1e-6 tolerance is the tightest meaningful bound here.
  assert.ok(Math.abs(mean) < 1e-6);
  assert.ok(Math.abs(variance - 1) < 1e-6);
  const flat = normalizeGray(gray(8, 8, () => 42));
  assert.ok(Array.from(flat.data).every(v => v === 0));
});

test('HeroMatcher resolves a resized+noisy variant of a reference and abstains on unknown noise', () => {
  // Synthetic smooth references (integer-frequency sinusoid mixtures on a
  // disjoint wave grid per hero) mimic real portraits: low-frequency content
  // that survives the 64->32->64 thumbnail round-trip. Wave pairs are disjoint
  // across heroes so cross-correlations stay near zero (DFT orthogonality).
  const rand = pseudoRandom(20241112);
  const frequencies = [];
  for (let fx = 1; fx <= 6; fx++) {
    for (let fy = 1; fy <= 6; fy++) frequencies.push([fx, fy]);
  }
  for (let i = frequencies.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [frequencies[i], frequencies[j]] = [frequencies[j], frequencies[i]];
  }
  const wavesFor = heroIndex => frequencies.slice(heroIndex * 5, heroIndex * 5 + 5)
    .map(([fx, fy], k) => ({ fx, fy, phase: pseudoRandom(7000 + heroIndex * 10 + k)() * Math.PI * 2, amp: 40 + pseudoRandom(9000 + heroIndex * 10 + k)() * 50 }));
  const patternFor = waves => gray(64, 64, (x, y) => {
    let v = 128;
    for (const w of waves) v += w.amp * Math.sin((2 * Math.PI * (w.fx * x + w.fy * y)) / 64 + w.phase);
    return Math.min(255, Math.max(0, Math.round(v)));
  });

  const patterns = [];
  const references = [];
  for (let i = 0; i < 6; i++) {
    const pattern = patternFor(wavesFor(i));
    patterns.push(pattern);
    const small = resizeGray(pattern, 32, 32);
    references.push({
      heroId: (i + 1) * 11,
      hash: dHash(normalizeGray(resizeGray(pattern, 64, 64))),
      thumb: aspectFit(normalizeGray(small), 32, 32),
    });
  }
  const matcher = new HeroMatcher(references);
  assert.equal(matcher.referenceCount, 6);

  // A crop that is a noisy variant of reference #2 must resolve to that hero.
  const noise = pseudoRandom(777);
  const base = patterns[2];
  const crop = gray(64, 64, (x, y) => {
    const offset = Math.floor((noise() - 0.5) * 32);
    return Math.min(255, Math.max(0, base.data[y * 64 + x] + offset));
  });
  const result = matcher.match(crop);
  assert.equal(result.abstained, false);
  assert.equal(result.heroId, 33);
  assert.ok(result.score > 0.8, `expected strong score, got ${result.score}`);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].heroId, 33);
  assert.ok(result.candidates[0].score >= result.candidates[1].score);

  // An unseen random-noise crop must abstain but still report the top-3.
  const unknown = matcher.match(gray(64, 64, () => Math.floor(pseudoRandom(424242)() * 256)));
  assert.equal(unknown.abstained, true);
  assert.equal(unknown.heroId, null);
  assert.equal(unknown.candidates.length, 3);
  assert.ok(unknown.score < 0.55);

  // Empty reference set always abstains with no candidates.
  const empty = new HeroMatcher([]).match(crop);
  assert.equal(empty.abstained, true);
  assert.equal(empty.heroId, null);
  assert.equal(empty.candidates.length, 0);
});

test('manual layout profile carries 16 slots', () => {
  const profile = buildManualRegionProfile(defaultManualLayoutConfig(3), 2800, 1260);
  assert.equal(profile.slots.length, 16);
  assert.equal(profile.version, 'manual-v1');
});

// ---------------------------------------------------------------------------
// Zoom search (heroMatcher): the in-game slot portrait can be displayed more
// zoomed in than the 128x128 reference framing, and the team-coloured lock
// badge overlaps the bottom-centre ~20% of the tile. Synthetic references use
// SMOOTH Gaussian-bump art (not sine waves): zooming a sinusoid shifts its
// apparent frequency and collapses correlation for ANY matcher, which would
// make the test unfair to the mechanism under test.
// ---------------------------------------------------------------------------

const ZOOM_REFERENCE_COUNT = 16;

function buildZoomReferenceSet() {
  const references = [];
  const samplers = [];
  // One well-separated Gaussian blob per hero on a 4x4 grid (sigma 5.5,
  // spacing 14.6 px): cross-correlations between different heroes stay ~0.1,
  // while mild zooms (<= 1.15x, blob drift < 5 px) keep the true hero's
  // correlation high — a fair test of the zoom-search mechanism.
  for (let i = 0; i < ZOOM_REFERENCE_COUNT; i++) {
    const cx = 10 + (i % 4) * 14.6;
    const cy = 10 + Math.floor(i / 4) * 14.6;
    const sampler = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return Math.min(255, Math.max(0, Math.round(60 + 95 * Math.exp(-(dx * dx + dy * dy) / (2 * 5.5 * 5.5)))));
    };
    samplers.push(sampler);
    const pattern = gray(64, 64, sampler);
    const small = resizeGray(pattern, 32, 32);
    references.push({
      heroId: (i + 1) * 7,
      hash: dHash(normalizeGray(resizeGray(pattern, 64, 64))),
      thumb: aspectFit(normalizeGray(small), 32, 32),
    });
  }
  return { references, samplers };
}

/**
 * Render an in-game-like slot tile: the hero art mapped through a zoom factor
 * (tile centre <-> reference centre), plus an optional solid lock badge over
 * the bottom-centre ~20% and an optional horizontal art shift (px, tile space).
 */
function renderSlotTile(sampler, tileW, tileH, zoom, opts = {}) {
  const badgeTop = opts.badge ? Math.floor(tileH * 0.8) : tileH;
  const badgeX0 = Math.floor(tileW * 0.26);
  const badgeX1 = Math.ceil(tileW * 0.74);
  const shift = opts.shift ?? 0;
  // The UI magnifies the 64x64 reference framing to fill the tile, optionally
  // zoomed further; tile centre maps to reference centre.
  const scale = (tileW / 64) * zoom;
  return gray(tileW, tileH, (x, y) => {
    if (y >= badgeTop && x >= badgeX0 && x < badgeX1) return 96; // lock badge
    const rx = 32 + (x + 0.5 - tileW / 2 - shift) / scale;
    const ry = 32 + (y + 0.5 - tileH / 2) / scale;
    if (rx < -1 || rx > 65 || ry < -1 || ry > 65) return 30 + ((x + y) % 3) * 10; // background fringe
    return sampler(rx, ry);
  });
}

test('zoom search: a badge-occluded slot tile still resolves the hero (badge-trim candidate rescues it)', () => {
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  const heroIndex = 5;
  const heroId = (heroIndex + 1) * 7;

  const clean = renderSlotTile(samplers[heroIndex], 147, 147, 1);
  const occluded = renderSlotTile(samplers[heroIndex], 147, 147, 1, { badge: true });

  const cleanResult = matcher.match(clean);
  assert.equal(cleanResult.heroId, heroId);
  const occludedResult = matcher.match(occluded);
  assert.equal(occludedResult.abstained, false, `badge occlusion must not break the match, got score ${occludedResult.score.toFixed(3)}`);
  assert.equal(occludedResult.heroId, heroId);
  assert.ok(occludedResult.score > 0.55, `score ${occludedResult.score.toFixed(3)} must clear the abstention threshold`);
  assert.equal(occludedResult.candidates.length, 3);
  assert.equal(occludedResult.candidates[0].heroId, heroId);
});

test('zoom search: a horizontally shifted portrait is recovered by the dx candidate offsets', () => {
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  const heroIndex = 6;
  const heroId = (heroIndex + 1) * 7;
  // Art shifted +4 px inside the tile (role-crest side): the dx=+4 candidate
  // crops back into alignment, so the match must still be confident.
  const shifted = renderSlotTile(samplers[heroIndex], 146, 147, 1, { shift: 4, badge: true });
  const result = matcher.match(shifted);
  assert.equal(result.abstained, false, `expected the dx candidate to realign, got score ${result.score.toFixed(3)}`);
  assert.equal(result.heroId, heroId);
});

test('zoom search: a mildly zoomed (1.15x) badge-occluded tile resolves the correct hero', () => {
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  const heroIndex = 2;
  const heroId = (heroIndex + 1) * 7;
  const tile = renderSlotTile(samplers[heroIndex], 147, 147, 1.15, { badge: true, shift: 2 });
  const result = matcher.match(tile);
  assert.equal(result.abstained, false, `expected a confident match, got score ${result.score.toFixed(3)}`);
  assert.equal(result.heroId, heroId);
  assert.ok(result.score > 0.55, `score ${result.score.toFixed(3)} must clear the abstention threshold`);
});

test('zoom search: the per-candidate dHash shortlist never excludes the true hero among 15 distractors', () => {
  // With 16 references and the default 12-entry shortlist, a shortlist taken
  // ONLY from the raw full crop could exclude the true hero once zooming and
  // occlusion changed its hash. The matcher shortlists per zoom candidate, so
  // the correct candidate must still rank the true hero first.
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references, { shortlistSize: 12 });
  const heroIndex = 1;
  const heroId = (heroIndex + 1) * 7;
  const tile = renderSlotTile(samplers[heroIndex], 146, 147, 1.15, { badge: true });
  const result = matcher.match(tile);
  assert.equal(result.abstained, false, `expected the true hero to survive shortlisting, got score ${result.score.toFixed(3)}`);
  assert.equal(result.heroId, heroId);
});

test('zoom search: a plain (unzoomed, unoccluded) crop still matches as before', () => {
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  const heroIndex = 2;
  const heroId = (heroIndex + 1) * 7;
  const result = matcher.match(gray(64, 64, samplers[heroIndex]));
  assert.equal(result.abstained, false);
  assert.equal(result.heroId, heroId);
  assert.ok(result.score > 0.9);
});

test('zoom search: abstention rules still apply to the best candidate', () => {
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  // Unseen random noise must abstain under every zoom candidate.
  const unknown = matcher.match(gray(64, 64, () => Math.floor(pseudoRandom(777)() * 256)));
  assert.equal(unknown.abstained, true);
  assert.equal(unknown.heroId, null);
  // A crop matching two references equally (mirror ambiguity) must abstain on margin.
  const heroIndex = 0;
  const twin = { ...references[heroIndex], heroId: 999 };
  const strictMatcher = new HeroMatcher([references[heroIndex], twin], { minMargin: 0.01 });
  const result = strictMatcher.match(gray(64, 64, samplers[heroIndex]));
  assert.equal(result.abstained, true, 'thin top-1 vs top-2 margin must abstain even with a high score');
  assert.equal(result.heroId, null);
});

// ---------------------------------------------------------------------------
// Per-kind abstention thresholds (FIX: ban identity must abstain, not guess).
// The measured corpus ban-score distribution has its maximum at 0.677 with a
// known false positive at 0.600 and NO verifiable-correct cluster above it,
// so DEFAULTS.banMinScore = 0.70 sits above every measured ban score while
// pick slots keep the original 0.55.
// ---------------------------------------------------------------------------

test('per-kind thresholds: ban defaults are stricter than pick defaults (measured)', () => {
  // The thresholds live in DEFAULTS; the ban score bound is documented there.
  // Verify through behaviour instead of reaching into privates: the same
  // confident crop identifies as a pick and abstains as a ban when the ban
  // threshold is pushed above its measured score.
  const { references, samplers } = buildZoomReferenceSet();
  const matcher = new HeroMatcher(references);
  const crop = gray(64, 64, samplers[3]);
  const pickResult = matcher.match(crop, { kind: 'pick' });
  assert.equal(pickResult.abstained, false);
  assert.ok(pickResult.score > 0.8, `expected a strong pick score, got ${pickResult.score}`);
  const strictBan = new HeroMatcher(references, { banMinScore: pickResult.score + 0.02 });
  const banResult = strictBan.match(crop, { kind: 'ban' });
  assert.equal(banResult.abstained, true, `ban kind must use banMinScore (${pickResult.score.toFixed(2)} < threshold)`);
  assert.equal(banResult.heroId, null);
  assert.equal(banResult.score, pickResult.score, 'the score itself is kind-independent');
  // Legacy banPadlock-only calls are treated as ban crops.
  const legacy = strictBan.match(crop, { banPadlock: true });
  assert.equal(legacy.abstained, true);
  // An explicit banMinMargin also applies only to ban crops.
  const marginMatcher = new HeroMatcher(references, { banMinMargin: 1.0 });
  assert.equal(marginMatcher.match(crop, { kind: 'ban' }).abstained, true);
  assert.equal(marginMatcher.match(crop, { kind: 'pick' }).abstained, false);
});

// ---------------------------------------------------------------------------
// Ban circle-masked matcher (references carrying full64). The in-game ban icon
// is a CIRCLE-MASKED portrait with a white padlock over its bottom-right;
// comparing it against a SQUARE reference caps every score (measured max
// 0.677, no separation). The ban path scores a masked NCC — circle r31 minus
// the padlock rect — against per-reference zoom/offset "ban-style" variants,
// with thresholds 0.72/0.10 measured against the operator-supplied ground
// truth for the six corpus draft-#1 bans (ban-identity-ground-truth.json):
// correct winners >= 0.834 with margins >= 0.20, wrong winners <= 0.640 with
// margins <= 0.02, at capture scales 1.0/0.686/0.5.
// ---------------------------------------------------------------------------

const BAN_TEST_HERO_COUNT = 8;

/** Build ban-capable references (hash/thumb/full64) from well-separated Gaussian blobs plus their raw 64x64 samplers. */
function buildBanReferenceSet() {
  const references = [];
  const samplers = [];
  const raw64s = [];
  for (let i = 0; i < BAN_TEST_HERO_COUNT; i += 1) {
    const cx = 10 + (i % 4) * 14.6;
    const cy = 10 + Math.floor(i / 4) * 14.6;
    const sampler = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return Math.min(255, Math.max(0, Math.round(60 + 95 * Math.exp(-(dx * dx + dy * dy) / (2 * 5.5 * 5.5)))));
    };
    samplers.push(sampler);
    const raw64 = gray(64, 64, sampler);
    raw64s.push(raw64);
    const full64 = normalizeGray(raw64);
    references.push({
      heroId: (i + 1) * 7,
      hash: dHash(full64),
      thumb: aspectFit(normalizeGray(resizeGray(raw64, 32, 32)), 32, 32),
      full64,
    });
  }
  return { references, samplers, raw64s };
}

/** Render a ban-style icon: the hero's zoomed central crop inside the full mask circle on a dark panel, padlock rectangle bottom-right. */
function renderBanIcon(raw64, zoom) {
  const s = Math.max(8, Math.round(64 / zoom));
  const o = Math.floor((64 - s) / 2);
  const sub = resizeGray(cropGray(raw64, { x: o, y: o, w: s, h: s }), 64, 64);
  return gray(64, 64, (x, y) => {
    const dx = x - 31.5;
    const dy = y - 31.5;
    if (dx * dx + dy * dy <= 31.4 * 31.4) return sub.data[y * 64 + x];
    if (x >= 38 && y >= 32) return 230; // padlock overlay (excluded by the ban mask)
    return 30; // dark panel behind the circular icon
  });
}

test('ban circle-masked matcher: identifies a circle-masked, zoomed, padlocked ban icon from full64 references', () => {
  const { references, raw64s } = buildBanReferenceSet();
  const matcher = new HeroMatcher(references);
  assert.equal(matcher.banReferenceCount, references.length);
  for (const zoom of [1.0, 1.15, 1.3]) {
    const heroIndex = 5;
    const heroId = (heroIndex + 1) * 7;
    const icon = renderBanIcon(raw64s[heroIndex], zoom);
    const result = matcher.match(icon, { kind: 'ban', banPadlock: true });
    assert.equal(result.abstained, false, `zoom ${zoom}: the true hero must clear the ban thresholds`);
    assert.equal(result.heroId, heroId, `zoom ${zoom}: the true hero must win`);
    assert.ok(result.score > 0.9, `zoom ${zoom}: expected a near-exact masked score, got ${result.score}`);
    assert.equal(result.candidates[0].heroId, heroId);
  }
});

test('ban circle-masked matcher: variant sampling matches the geometry pipeline exactly (plan parity)', () => {
  const { references, raw64s } = buildBanReferenceSet();
  // A relaxed margin floor: this test verifies SAMPLING parity (the variant's
  // own hero must score ~1), not abstention — at high zoom the synthetic blob
  // grid lets a neighbouring blob score ~0.9, tripping the measured 0.10 floor.
  const matcher = new HeroMatcher(references, { banMinScore: 0.9, banMinMargin: 0.05 });
  // A crop that IS one reference's zoomed+offset variant must score ~1 under
  // that hero: this exercises the shared sampling plan (bilinear taps with
  // cropGray clamping) end to end against cropGray+resizeGray itself.
  for (const [zoom, dx, dy] of [[1.2, 2, -4], [1.45, -4, 2], [1.0, 0, 0]]) {
    const heroIndex = 2;
    const heroId = (heroIndex + 1) * 7;
    const s = Math.max(8, Math.round(64 / zoom));
    const o = Math.floor((64 - s) / 2);
    const crop = resizeGray(cropGray(references[heroIndex].full64, { x: o + dx, y: o + dy, w: s, h: s }), 64, 64);
    const result = matcher.match(crop, { kind: 'ban' });
    assert.equal(result.heroId, heroId, `config ${zoom}/${dx}/${dy}: the variant's own hero must win`);
    assert.ok(result.score > 0.99, `config ${zoom}/${dx}/${dy}: masked score must be ~1, got ${result.score}`);
  }
});

test('ban circle-masked matcher: ambiguous twins abstain on margin, noise abstains on score', () => {
  const { references, raw64s } = buildBanReferenceSet();
  const twin = { ...references[3], heroId: 999 };
  const matcher = new HeroMatcher([...references, twin]);
  const icon = renderBanIcon(raw64s[3], 1.15);
  const result = matcher.match(icon, { kind: 'ban' });
  assert.equal(result.abstained, true, 'two equally-good references must abstain on the margin floor');
  assert.equal(result.heroId, null);
  const noise = matcher.match(gray(64, 64, () => Math.floor(pseudoRandom(4242)() * 256)), { kind: 'ban' });
  assert.equal(noise.abstained, true, 'random noise must abstain below banMinScore');
  assert.equal(noise.heroId, null);
});

test('browser-only vision modules import cleanly in Node without touching DOM', async () => {
  const capture = await import('../src/vision/capture.ts');
  const referenceSet = await import('../src/vision/referenceSet.ts');
  assert.equal(typeof capture.CaptureSource, 'function');
  assert.equal(capture.CaptureSource.isSupported(), false); // Node has no getDisplayMedia
  assert.equal(typeof referenceSet.loadReferenceSet, 'function');
});

test('ban circle-masked matcher: chroma Cb/Cr separates grayscale-identical twins when RGBA is provided', () => {
  const { references, raw64s } = buildBanReferenceSet();
  // Create two heroes with IDENTICAL grayscale (full64) but opposite colour gradients.
  const base = raw64s[0];
  const warmRgba = new Uint8ClampedArray(64 * 64 * 4);
  const coolRgba = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const i = y * 64 + x;
      const g = base.data[i];
      const p = i * 4;
      const shift = x < 32 ? 40 : -40;
      warmRgba[p] = Math.min(255, Math.max(0, g + shift));
      warmRgba[p + 1] = g;
      warmRgba[p + 2] = Math.min(255, Math.max(0, g - shift));
      warmRgba[p + 3] = 255;
      coolRgba[p] = Math.min(255, Math.max(0, g - shift));
      coolRgba[p + 1] = g;
      coolRgba[p + 2] = Math.min(255, Math.max(0, g + shift));
      coolRgba[p + 3] = 255;
    }
  }
  const warmChroma = toCbCr({ width: 64, height: 64, data: warmRgba });
  const coolChroma = toCbCr({ width: 64, height: 64, data: coolRgba });
  const warmRef = { ...references[0], heroId: 101, cb64: warmChroma.cb, cr64: warmChroma.cr };
  const coolRef = { ...references[0], heroId: 202, cb64: coolChroma.cb, cr64: coolChroma.cr };
  const matcher = new HeroMatcher([warmRef, coolRef]);
  const iconGray = renderBanIcon(base, 1.0);
  // Grayscale-only must abstain (margin = 0).
  const grayOnly = matcher.match(iconGray, { kind: 'ban' });
  assert.equal(grayOnly.abstained, true);
  // With warm RGBA supplied, hero 101 separates cleanly and wins.
  const withColor = matcher.match(iconGray, { kind: 'ban', rgba: { width: 64, height: 64, data: warmRgba } });
  assert.equal(withColor.abstained, false);
  assert.equal(withColor.heroId, 101);
});

test('multi-variant references: duplicate heroId variants compute margin against next distinct hero (pick & ban)', () => {
  const { references: zoomRefs, samplers: zoomSamplers } = buildZoomReferenceSet();
  const targetPick = zoomRefs[0];
  const pickMatcher = new HeroMatcher([...zoomRefs, { ...targetPick }]);
  const pickRes = pickMatcher.match(gray(64, 64, zoomSamplers[0]), { kind: 'pick' });
  assert.equal(pickRes.abstained, false);
  assert.equal(pickRes.heroId, targetPick.heroId);
  assert.equal(new Set(pickRes.candidates.map(c => c.heroId)).size, pickRes.candidates.length);

  const { references: banRefs, raw64s } = buildBanReferenceSet();
  const targetBan = banRefs[3];
  const banMatcher = new HeroMatcher([...banRefs, { ...targetBan }]);
  const banRes = banMatcher.match(renderBanIcon(raw64s[3], 1.15), { kind: 'ban' });
  assert.equal(banRes.abstained, false);
  assert.equal(banRes.heroId, targetBan.heroId);
  assert.equal(new Set(banRes.candidates.map(c => c.heroId)).size, banRes.candidates.length);
});

test('ban Tier-2 Pure-TS 8x8 Patch Max-Sim: rescues a slightly shifted colour-distinct ban crop when Tier-1 NCC abstains', () => {
  const { references } = buildBanReferenceSet();
  // Create a distinct high-contrast colour pattern per hero so Tier-2 patch Max-Sim has structure to match.
  const makeRgba = (cx, cy, rBias, bBias) => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const g = Math.min(255, Math.max(0, Math.round(40 + 180 * Math.exp(-(dx * dx + dy * dy) / (2 * 6 * 6)))));
        const p = (y * 64 + x) * 4;
        data[p] = Math.min(255, Math.max(0, g + rBias));
        data[p + 1] = g;
        data[p + 2] = Math.min(255, Math.max(0, g + bBias));
        data[p + 3] = 255;
      }
    }
    return { width: 64, height: 64, data };
  };
  const rgbaA = makeRgba(20, 22, 60, -40);
  const rgbaB = makeRgba(40, 22, -40, 60);
  const cA = toCbCr(rgbaA);
  const cB = toCbCr(rgbaB);
  const gA = normalizeGray(toGray(rgbaA));
  const gB = normalizeGray(toGray(rgbaB));
  const refA = { ...references[0], heroId: 301, full64: gA, cb64: cA.cb, cr64: cA.cr };
  const refB = { ...references[1], heroId: 302, full64: gB, cb64: cB.cb, cr64: cB.cr };
  // Force Tier-1 to abstain (banMinScore: 0.99) while Tier-2 Patch Max-Sim runs on the slightly shifted crop.
  const matcher = new HeroMatcher([refA, refB], { banMinScore: 0.99 });
  const shiftedQuery = makeRgba(23, 25, 60, -40);
  const res = matcher.match(toGray(shiftedQuery), { kind: 'ban', rgba: shiftedQuery });
  assert.equal(res.abstained, false);
  assert.equal(res.heroId, 301);
});

test('pick Tier-2 Pure-TS 8x8 Patch Max-Sim: rescues a shifted/bottom-occluded pick crop when Tier-1 NCC abstains', () => {
  const makeRgba = (cx, cy, rBias, bBias, bottomWhite = false) => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const p = (y * 64 + x) * 4;
        if (bottomWhite && y >= 48) {
          data[p] = 250; data[p + 1] = 250; data[p + 2] = 250; data[p + 3] = 255;
          continue;
        }
        const d = Math.hypot(x - cx, y - cy);
        const g = Math.max(20, Math.min(220, Math.round(200 * Math.exp(-(d * d) / 90) + 20)));
        const rWave = Math.round(rBias * Math.cos((x - cx) / 10));
        const bWave = Math.round(bBias * Math.sin((y - cy) / 10));
        data[p] = Math.min(255, Math.max(0, g + rWave));
        data[p + 1] = g;
        data[p + 2] = Math.min(255, Math.max(0, g + bWave));
        data[p + 3] = 255;
      }
    }
    return { width: 64, height: 64, data };
  };
  const rgbaA = makeRgba(20, 22, 60, -40);
  const rgbaB = makeRgba(40, 22, -40, 60);
  const cA = toCbCr(rgbaA);
  const cB = toCbCr(rgbaB);
  const gA = normalizeGray(toGray(rgbaA));
  const gB = normalizeGray(toGray(rgbaB));
  const refA = { heroId: 521, hash: dHash(gA), thumb: gA, full64: gA, cb64: cA.cb, cr64: cA.cr };
  const refB = { heroId: 538, hash: dHash(gB), thumb: gB, full64: gB, cb64: cB.cb, cr64: cB.cr };
  // Force Tier-1 pick NCC to abstain (minScore: 0.99) while Tier-2 Patch Max-Sim ignores y >= 48 lock chevron.
  const matcher = new HeroMatcher([refA, refB], { minScore: 0.99 });
  const shiftedOccludedQuery = makeRgba(23, 25, 60, -40, true);
  const res = matcher.match(toGray(shiftedOccludedQuery), { kind: 'pick', rgba: shiftedOccludedQuery });
  assert.equal(res.abstained, false);
  assert.equal(res.heroId, 521);
});

test('manualLayout: builds square pick/ban slots across 20:9 phone, 16:10 tablet, and 4:3 iPad with 3 or 5 bans per side', () => {
  const cfg3 = defaultManualLayoutConfig(3);
  const ipadProfile = buildManualRegionProfile(cfg3, 2048, 1536); // 4:3 iPad
  assert.equal(ipadProfile.slots.length, 16);
  const picks = ipadProfile.slots.filter(s => s.kind === 'pick');
  assert.equal(picks.length, 10);
  // Pick tiles stay square in pixel space regardless of 4:3 aspect ratio.
  assert.equal(picks[0].rect.w, picks[0].rect.h);
  // Intermediate rows P2..P4 interpolate evenly between P1 (index 0) and P5 (index 4).
  const stepY = (picks[4].rect.y - picks[0].rect.y) / 4;
  assert.ok(Math.abs(picks[2].rect.y - (picks[0].rect.y + 2 * stepY)) <= 1);
  // The right column mirrors the left column about the MEASURED axis
  // (pick.centerX = 2815/5600 on the calibrated Ranked profile), not about the
  // frame centre: the two team columns in-game are not exactly symmetric.
  const pickMirrorAxisX = Math.round(2 * (cfg3.pick.centerX ?? 0.5) * 2048);
  assert.ok(Math.abs((picks[0].rect.x + picks[0].rect.w) - (pickMirrorAxisX - picks[5].rect.x)) <= 1);

  const cfg5 = defaultManualLayoutConfig(5);
  const tabProfile = buildManualRegionProfile(cfg5, 2560, 1600); // 16:10 tablet, Tournament 5 bans/side
  assert.equal(tabProfile.slots.length, 20);
  assert.equal(tabProfile.slots.filter(s => s.kind === 'ban').length, 10);

  // Shifting pick.centerX moves right-side picks without shifting right-side bans.
  const basePickCenterX = cfg3.pick.centerX ?? 0.5;
  const shifted = buildManualRegionProfile({
    ...cfg3,
    pick: { ...cfg3.pick, centerX: basePickCenterX + 0.02 },
  }, 2000, 1000);
  const shiftedRightPick = shifted.slots.find(s => s.kind === 'pick' && s.index === 5);
  const shiftedRightBan = shifted.slots.find(s => s.kind === 'ban' && s.index === 13);
  const base = buildManualRegionProfile(cfg3, 2000, 1000);
  const baseRightPick = base.slots.find(s => s.kind === 'pick' && s.index === 5);
  const baseRightBan = base.slots.find(s => s.kind === 'ban' && s.index === 13);
  assert.ok(shiftedRightPick && baseRightPick && shiftedRightBan && baseRightBan);
  // 0.02 of the frame width on both sides of the axis = 80 px at w = 2000.
  assert.ok(Math.abs((shiftedRightPick.rect.x - baseRightPick.rect.x) - 80) <= 1);
  assert.equal(shiftedRightBan.rect.x, baseRightBan.rect.x);
});
