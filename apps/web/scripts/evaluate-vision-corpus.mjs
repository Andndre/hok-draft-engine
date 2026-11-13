#!/usr/bin/env node
/**
 * Evaluation harness for the vision layer against the captured HoK Global
 * corpus (data/vision-corpus, gitignored).
 *
 * It runs the REAL HeroMatcher (imported straight from src/vision via the
 * repo's TypeScript loader) over every corpus frame in range, crops each slot
 * rect of a RegionProfile (scaled from the profile resolution to the frame
 * resolution exactly like the live pipeline must), and reports temporal
 * stability, change-point agreement with documented lock frames, duplicate
 * hero ids per pick frame, and abstention rates — overall AND per kind, with
 * the ban identification rate reported explicitly (ban slots are matched with
 * `kind: 'ban'` exactly like the live path). Since the circle-masked ban
 * strategy (see heroMatcher.ts) ban identity is ACTIVE where the references
 * carry full64: thresholds 0.72/0.10 were measured against the
 * operator-supplied ban ground truth
 * (tests/fixtures/vision/ban-identity-ground-truth.json, draft #1 only), and
 * `metrics.banIdentity` reports ban identity accuracy per icon against it.
 *
 * --scale S downscales every decoded frame to round(width*S) x round(height*S)
 * BEFORE the slot rects are scaled from profile space onto the frame — this
 * simulates a smaller live capture window (e.g. --scale 0.7 ≈ 1960x882) with
 * less per-slot detail; the profile rects stay in profile space and are
 * rescaled onto the downscaled frame exactly like the live pipeline does.
 *
 * NOTE: pick identity is measured against hero-identity-ground-truth.json only
 * outside this script (see the report's banIdentity section for the ban ground
 * truth); other frames measure consistency and stability — NOT correctness.
 *
 * Usage:
 *   node apps/web/scripts/evaluate-vision-corpus.mjs \
 *     --corpus <dir> --profile <regionProfile.json> --reference <pngDir> \
 *     --annotations apps/web/tests/fixtures/vision/annotations.json \
 *     [--from N] [--to N] [--ranges "28-78,222-256"] [--exclude "32-36,50-54"] \
 *     [--out report.json] [--min-score 0.55] [--min-margin 0.04] [--frame N] [--scale 1.0] \
 *     [--ban-gt ban-identity-ground-truth.json]
 */
import { register } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The repo's TypeScript loader lets us import the real .ts vision sources.
register(new URL('../tests/typescript-loader.mjs', import.meta.url));

const { decodePng } = await import('./png-decode.mjs');
const { toGray, toCbCr, cropGray, cropRgba, resizeGray } = await import('../src/vision/geometry.ts');
const { HeroMatcher } = await import('../src/vision/heroMatcher.ts');

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Parse `--key value` pairs; returns { [key]: string } plus positional leftovers. */
function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      options[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      options[arg.slice(2)] = argv[++i];
    } else {
      options[arg.slice(2)] = 'true';
    }
  }
  return options;
}

/** Print usage help (Indonesian) and exit. */
function printHelp() {
  console.log(`Pengukur akurasi lapisan visi terhadap corpus draft HoK Global.

Pemakaian:
  node scripts/evaluate-vision-corpus.mjs --corpus <folder-corpus> --profile <profil.json> \\
    --reference <folder-png-referensi> --annotations <annotations.json> \\
    [--from N] [--to N] [--out laporan.json] [--min-score 0.55] [--min-margin 0.04] [--frame N]

Wajib:
  --corpus        folder data/vision-corpus (berisi manifest.jsonl + frame PNG)
  --profile       berkas JSON berbentuk RegionProfile (lane kalibrasi)
  --reference     folder PNG potret hero hasil convert_reference_images.py
  --annotations   berkas ground truth manual (tests/fixtures/vision/annotations.json)

Opsional:
  --from/--to     rentang index frame (default: contentFrames dari annotations)
  --ranges        daftar rentang dipisah koma, menimpa --from/--to, contoh: "28-78,222-256"
  --exclude       daftar rentang frame yang dibuang, contoh: "32-36,50-54" (overlay di board)
  --frame         satu frame perwakilan untuk tabel per-slot (default: frame pick terakhir)
  --out           jalur laporan JSON (default: folder temp sistem)
  --scale         faktor downscale frame (default 1.0; 0.7 ≈ jendela fullscreen, 0.5 ≈ jendela kecil)
  --min-score     ambang score matcher slot PICK (default 0.55)
  --min-margin    ambang margin top-1 vs top-2 slot PICK (default 0.04)
  --ban-gt        berkas ground truth identitas ban (default: tests/fixtures/vision/ban-identity-ground-truth.json)

Slot BAN selalu di-match dengan kind:'ban' seperti jalur live. Dengan referensi
full64 (path ini selalu menyediakannya), matcher memakai strategi ban
circle-masked terukur: ambang ban bawaan HeroMatcher (banMinScore=0.72,
banMinMargin=0.10 — diukur dari ground truth ban operator, lihat DEFAULTS di
heroMatcher.ts). Ground truth ban (draft #1) otomatis dimuat dari
tests/fixtures/vision/ban-identity-ground-truth.json, atau timpa dengan --ban-gt;
akurasi identitas ban per ikon dilaporkan di ringkasan.`);
}

function fail(message) {
  console.error(`GALAT: ${message}`);
  process.exit(2);
}

/** Parse a "28-78,222-256" spec into an inclusive list of { from, to } ranges. */
function parseRanges(spec, label) {
  const ranges = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('-');
    if (parts.length === 1) {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) fail(`Rentang ${label} tidak valid: "${trimmed}" (harus bilangan bulat).`);
      ranges.push({ from: n, to: n });
    } else if (parts.length === 2) {
      const from = Number(parts[0]);
      const to = Number(parts[1]);
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
        fail(`Rentang ${label} tidak valid: "${trimmed}" (harus "a-b" dengan b >= a).`);
      }
      ranges.push({ from, to });
    } else {
      fail(`Rentang ${label} tidak valid: "${trimmed}".`);
    }
  }
  if (ranges.length === 0) fail(`Opsi ${label} tidak memuat rentang apa pun.`);
  return ranges;
}

/** True when `index` falls inside any of the inclusive ranges. */
function inRanges(index, ranges) {
  return ranges.some(range => index >= range.from && index <= range.to);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Load and validate a RegionProfile-shaped JSON file. */
function loadProfile(path) {
  if (!path) {
    fail('Opsi --profile wajib diisi. Profil RegionProfile dibuat oleh lane kalibrasi '
      + '(format: {version, resolution:{width,height}, slots:[{index,rect,side,kind}], anchors:[...]}); '
      + 'lihat apps/web/src/vision/regionMap.ts untuk kontrak tipenya.');
  }
  if (!existsSync(path)) {
    fail(`Berkas profil tidak ditemukan: ${path}. Berikan --profile yang menunjuk ke JSON RegionProfile.`);
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Profil ${path} bukan JSON valid: ${error.message}`);
  }
  if (!profile || typeof profile !== 'object') fail(`Profil ${path} bukan objek JSON.`);
  if (!profile.resolution || !Number.isFinite(profile.resolution.width) || !Number.isFinite(profile.resolution.height)) {
    fail(`Profil ${path} tidak punya resolution {width,height} yang valid.`);
  }
  if (!Array.isArray(profile.slots) || profile.slots.length === 0) {
    fail(`Profil ${path} tidak punya slot (slots:[] kosong). Kalibrasi lane harus mengisi 18 slot ban/pick dulu.`);
  }
  for (const slot of profile.slots) {
    if (!slot.rect || [slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h].some(v => !Number.isFinite(v))) {
      fail(`Slot index=${slot.index} (${slot.side}/${slot.kind}) di ${path} tidak punya rect {x,y,w,h} numerik.`);
    }
  }
  return profile;
}

/** Load the manual annotations file (locks, phases, contentFrames). */
function loadAnnotations(path) {
  if (!path || !existsSync(path)) {
    fail('Opsi --annotations wajib diisi dan harus menunjuk ke apps/web/tests/fixtures/vision/annotations.json.');
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data.locks)) fail(`annotations ${path} tidak punya array "locks".`);
    if (!data.contentFrames || !Number.isFinite(data.contentFrames.from)) {
      fail(`annotations ${path} tidak punya contentFrames {from,to}.`);
    }
    return data;
  } catch (error) {
    fail(`Annotations ${path} bukan JSON valid: ${error.message}`);
    return null;
  }
}

/** Read the corpus manifest into ordered entries {index, file, resolution}. */
function loadManifest(corpusDir) {
  const manifestPath = join(corpusDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) fail(`manifest.jsonl tidak ditemukan di ${corpusDir}.`);
  const entries = [];
  for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      entries.push({ index: Number(record.index), file: record.file, resolution: String(record.resolution ?? '') });
    } catch {
      // A malformed manifest line is skipped, never fatal.
    }
  }
  entries.sort((a, b) => a.index - b.index);
  return entries;
}

/** Build ReferenceEntry[] exactly like src/vision/referenceSet.ts does in-browser. */
async function loadReferences(referenceDir) {
  if (!existsSync(referenceDir)) fail(`Folder referensi tidak ditemukan: ${referenceDir}.`);
  const files = readdirSync(referenceDir).filter(name => name.toLowerCase().endsWith('.png')).sort();
  if (files.length === 0) {
    fail(`Tidak ada PNG di ${referenceDir}. Jalankan dulu: uv run convert_reference_images.py --out ${referenceDir}`);
  }
  const { aspectFit, dHash, normalizeGray, resizeGray } = await import('../src/vision/geometry.ts');
  const entries = [];
  const skipped = [];
  for (const file of files) {
    const heroId = Number.parseInt(file, 10);
    if (!Number.isInteger(heroId)) {
      skipped.push(file);
      continue;
    }
    try {
      const rgba = decodePng(readFileSync(join(referenceDir, file)));
      const gray = toGray(rgba);
      const { cb, cr } = toCbCr(rgba);
      // Mirrored from referenceSet.ts: 32x32 small thumb + hash on the SAME
      // normalized 64x64 pipeline HeroMatcher applies to crops, plus the
      // normalized 64x64 portrait itself (full64) and Cb/Cr planes for ban chroma.
      const full64 = normalizeGray(resizeGray(gray, 64, 64));
      const small = resizeGray(gray, 32, 32);
      entries.push({
        heroId,
        hash: dHash(full64),
        thumb: aspectFit(normalizeGray(small), 32, 32),
        full64,
        cb64: resizeGray(cb, 64, 64),
        cr64: resizeGray(cr, 64, 64),
      });
    } catch (error) {
      skipped.push(`${file} (${error.message})`);
    }
  }
  if (skipped.length) console.error(`Peringatan: ${skipped.length} berkas referensi dilewati: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' ...' : ''}`);
  if (entries.length === 0) fail('Tidak ada referensi hero yang berhasil dimuat — matcher akan abstain untuk semua slot.');
  return entries;
}

/** Load the ban-identity ground truth fixture (optional; operator-supplied, draft #1 only). */
function loadBanGroundTruth(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data.strips)) return null;
    const bySlot = new Map();
    for (const strip of data.strips) {
      for (const slot of strip.slots ?? []) {
        bySlot.set(slot.slotIndexInProfile, {
          heroId: slot.hero_id,
          heroName: slot.hero_name,
          side: strip.side,
          stripOrder: slot.stripOrder,
        });
      }
    }
    return { data, bySlot };
  } catch (error) {
    console.error(`Peringatan: ground truth ban ${path} gagal dibaca (${error.message}) — dilanjutkan tanpa metrik identitas ban.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Matching pass
// ---------------------------------------------------------------------------

/** Scale a profile rect from profile resolution to frame resolution. */
function scaleRect(rect, scaleX, scaleY) {
  return { x: rect.x * scaleX, y: rect.y * scaleY, w: rect.w * scaleX, h: rect.h * scaleY };
}

/** Run the matcher over every slot of every frame in range.
 * `captureScale` < 1 downscales each decoded frame before cropping, simulating
 * a smaller live capture window. */
function evaluateFrames(frames, profile, matcher, captureScale = 1) {
  const perFrame = [];
  for (const frame of frames) {
    let gray;
    let rgba;
    try {
      const decoded = decodePng(frame.bytes);
      gray = toGray(decoded);
      rgba = decoded;
      if (captureScale !== 1) {
        const width = Math.round(gray.width * captureScale);
        const height = Math.round(gray.height * captureScale);
        if (width < 1 || height < 1) throw new Error(`skala ${captureScale} menghasilkan frame ${width}x${height}`);
        gray = resizeGray(gray, width, height);
        const out = new Uint8ClampedArray(width * height * 4);
        const xr = decoded.width / width, yr = decoded.height / height;
        for (let y = 0; y < height; y += 1) {
          const sy = Math.min(decoded.height - 1, Math.floor((y + 0.5) * yr));
          for (let x = 0; x < width; x += 1) {
            const sx = Math.min(decoded.width - 1, Math.floor((x + 0.5) * xr));
            const sp = (sy * decoded.width + sx) * 4;
            const dp = (y * width + x) * 4;
            out[dp] = decoded.data[sp];
            out[dp + 1] = decoded.data[sp + 1];
            out[dp + 2] = decoded.data[sp + 2];
            out[dp + 3] = decoded.data[sp + 3];
          }
        }
        rgba = { width, height, data: out };
      }
    } catch (error) {
      perFrame.push({ index: frame.index, file: frame.file, error: error.message, slots: [] });
      continue;
    }
    const scaleX = gray.width / profile.resolution.width;
    const scaleY = gray.height / profile.resolution.height;
    const slots = profile.slots.map(slot => {
      const scaled = scaleRect(slot.rect, scaleX, scaleY);
      const crop = cropGray(gray, scaled);
      const emptyCrop = crop.width === 0 || crop.height === 0;
      const slotRgba = cropRgba(rgba, scaled);
      // Mirror the live path (pipeline.ts) exactly: ban slots get the extra
      // padlock-avoiding candidate AND the stricter per-kind abstention
      // thresholds (kind: 'ban' -> banMinScore/banMinMargin dari HeroMatcher).
      const result = matcher.match(crop, { kind: slot.kind === 'ban' ? 'ban' : 'pick', banPadlock: slot.kind === 'ban', rgba: slotRgba });
      const classification = result.heroId !== null ? 'filled' : (result.abstained ? 'unidentified' : 'empty');
      return {
        index: slot.index,
        side: slot.side,
        kind: slot.kind,
        classification,
        heroId: result.heroId,
        score: Number(result.score.toFixed(6)),
        abstained: result.abstained,
        emptyCrop,
        candidates: result.candidates.map(c => ({ heroId: c.heroId, score: Number(c.score.toFixed(6)) })),
      };
    });
    perFrame.push({ index: frame.index, file: frame.file, resolution: `${gray.width}x${gray.height}`, slots });
  }
  return perFrame;
}

/** Group key of a slot observation (side:kind:index). */
function slotKey(slot) {
  return `${slot.side}:${slot.kind}:${slot.index}`;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Temporal stability per slot over adjacent filled observations (null when < 2 filled frames). */
function computeStability(perFrame) {
  const sequences = new Map();
  for (const frame of perFrame) {
    for (const slot of frame.slots) {
      if (slot.classification !== 'filled') continue;
      const key = slotKey(slot);
      if (!sequences.has(key)) sequences.set(key, []);
      sequences.get(key).push({ frame: frame.index, heroId: slot.heroId });
    }
  }
  const perSlot = [];
  for (const [key, seq] of sequences) {
    let same = 0;
    const changes = [];
    for (let i = 1; i < seq.length; i += 1) {
      if (seq[i].heroId === seq[i - 1].heroId) same += 1;
      else changes.push({ at: seq[i].frame, from: seq[i - 1].heroId, to: seq[i].heroId });
    }
    perSlot.push({ slot: key, filledFrames: seq.length, pairs: seq.length - 1, stablePairs: same, stability: seq.length < 2 ? null : same / (seq.length - 1), changes });
  }
  perSlot.sort((a, b) => (a.stability ?? 1) - (b.stability ?? 1));
  return perSlot;
}

/** For each observed hero change, the nearest documented lock frame from annotations. */
function computeChangePoints(perSlot, locks) {
  const changes = [];
  for (const entry of perSlot) {
    for (const change of entry.changes) {
      const nearest = locks.reduce((best, lock) => {
        const distance = Math.abs(change.at - lock.frame);
        return !best || distance < best.distance ? { ...lock, distance } : best;
      }, null);
      changes.push({
        slot: entry.slot,
        frame: change.at,
        from: change.from,
        to: change.to,
        nearestDocumentedLock: nearest ? { frame: nearest.frame, side: nearest.side, slot: nearest.slot, distance: nearest.distance } : null,
        withinOneFrameOfLock: Boolean(nearest && nearest.distance <= 1),
      });
    }
  }
  changes.sort((a, b) => a.frame - b.frame);
  return changes;
}

/** Hero ids picked twice within a single frame across PICK slots.
 * With explicit --ranges, every processed frame is checked (the legacy
 * annotations phases only describe draft #1); otherwise only PICK-phase frames.
 * BAN slots are deliberately EXCLUDED: a ban identity is an `estimated`
 * soft signal (it never enters the draft position), and with the circle-masked
 * ban path active a wrong ban guess must never masquerade as a pick-legality
 * violation — the check validates PICK uniqueness only. */
function computeDuplicates(perFrame, phases, explicitRanges) {
  const pickFrameIndexes = new Set();
  if (explicitRanges) {
    for (const frame of perFrame) pickFrameIndexes.add(frame.index);
  } else {
    for (const phase of phases.filter(p => String(p.phase).startsWith('PICK'))) {
      for (let i = phase.from; i <= phase.to; i += 1) pickFrameIndexes.add(i);
    }
  }
  const violations = [];
  const perFrameDuplicates = [];
  for (const frame of perFrame) {
    if (!pickFrameIndexes.has(frame.index) || frame.slots.length === 0) continue;
    const byHero = new Map();
    for (const slot of frame.slots) {
      if (slot.classification !== 'filled' || slot.kind !== 'pick') continue;
      const list = byHero.get(slot.heroId) ?? [];
      list.push(`${slot.side}:${slot.kind}:${slot.index}`);
      byHero.set(slot.heroId, list);
    }
    const duplicates = [...byHero.entries()].filter(([, slots]) => slots.length > 1);
    if (duplicates.length) {
      perFrameDuplicates.push(duplicates.map(([heroId, slots]) => ({ frame: frame.index, heroId, slots })));
      for (const [heroId, slots] of duplicates) violations.push({ frame: frame.index, heroId, slots });
    }
  }
  return { checkedFrames: pickFrameIndexes.size, violations, perFrameDuplicates };
}

/** Abstention rates: overall, per kind (ban vs pick — the live path abstains on bans by design), plus restricted to presumed-not-yet-filled slot-frames. */
function computeAbstention(perFrame) {
  let total = 0;
  let unidentified = 0;
  let empty = 0;
  let filled = 0;
  const byKind = new Map();
  const firstFilled = new Map();
  for (const frame of perFrame) {
    for (const slot of frame.slots) {
      total += 1;
      const kindStat = byKind.get(slot.kind) ?? { totalSlotFrames: 0, filled: 0, empty: 0, unidentified: 0, identifiedRate: null, abstentionRate: null };
      byKind.set(slot.kind, kindStat);
      kindStat.totalSlotFrames += 1;
      if (slot.classification === 'filled') {
        filled += 1;
        kindStat.filled += 1;
        const key = slotKey(slot);
        if (!firstFilled.has(key) || frame.index < firstFilled.get(key)) firstFilled.set(key, frame.index);
      } else if (slot.classification === 'unidentified') {
        unidentified += 1;
        kindStat.unidentified += 1;
      } else {
        empty += 1;
        kindStat.empty += 1;
      }
    }
  }
  for (const kindStat of byKind.values()) {
    kindStat.identifiedRate = kindStat.totalSlotFrames ? kindStat.filled / kindStat.totalSlotFrames : null;
    kindStat.abstentionRate = kindStat.totalSlotFrames ? kindStat.unidentified / kindStat.totalSlotFrames : null;
  }
  // Presumed-empty window: frames before a slot's FIRST filled observation.
  let presumedEmpty = 0;
  let presumedEmptyUnidentified = 0;
  for (const frame of perFrame) {
    for (const slot of frame.slots) {
      const key = slotKey(slot);
      if (firstFilled.has(key) && frame.index < firstFilled.get(key)) {
        presumedEmpty += 1;
        if (slot.classification === 'unidentified') presumedEmptyUnidentified += 1;
      }
    }
  }
  return {
    totalSlotFrames: total,
    filled,
    empty,
    unidentified,
    abstentionRate: total ? unidentified / total : null,
    byKind: Object.fromEntries([...byKind.entries()].sort()),
    presumedEmptyWindow: { slotFrames: presumedEmpty, unidentified: presumedEmptyUnidentified, abstentionRate: presumedEmpty ? presumedEmptyUnidentified / presumedEmpty : null },
  };
}

/**
 * Ban identity accuracy against the operator-supplied ground truth (draft #1
 * only — the fixture scopes itself). For every processed ban slot-frame inside
 * the ground-truth window (`session.frames.from`..`to`, and at/after
 * `session.banFilledFrom` so empty early frames do not dilute the metric),
 * compare the matcher's recognized id with the expected one. Returns the
 * per-icon breakdown (recognized ids, scores, correct/identified counts) plus
 * the aggregate accuracy numbers that did not exist before this fixture.
 */
function computeBanIdentity(perFrame, banGroundTruth) {
  if (!banGroundTruth) return null;
  const session = banGroundTruth.data.session ?? {};
  const from = session.frames?.from ?? -Infinity;
  const to = session.frames?.to ?? Infinity;
  const banFilledFrom = session.banFilledFrom ?? from;
  const perIcon = new Map();
  let total = 0;
  let identified = 0;
  let correct = 0;
  let wrongIdentified = 0;
  let abstained = 0;
  const wrongDetails = [];
  for (const frame of perFrame) {
    if (frame.error) continue;
    if (frame.index < Math.max(from, banFilledFrom) || frame.index > to) continue;
    for (const slot of frame.slots) {
      if (slot.kind !== 'ban') continue;
      const expected = banGroundTruth.bySlot.get(slot.index);
      if (!expected) continue;
      total += 1;
      const icon = perIcon.get(slot.index) ?? {
        index: slot.index,
        side: slot.side,
        expectedHeroId: expected.heroId,
        expectedHeroName: expected.heroName,
        frames: 0,
        identified: 0,
        correct: 0,
        wrongIds: new Map(),
        correctScores: [],
      };
      icon.frames += 1;
      if (slot.heroId !== null) {
        identified += 1;
        icon.identified += 1;
        if (slot.heroId === expected.heroId) {
          correct += 1;
          icon.correct += 1;
          icon.correctScores.push(slot.score);
        } else {
          wrongIdentified += 1;
          icon.wrongIds.set(slot.heroId, (icon.wrongIds.get(slot.heroId) ?? 0) + 1);
          wrongDetails.push({ frame: frame.index, slot: slot.index, expected: expected.heroId, got: slot.heroId, score: slot.score });
        }
      } else if (slot.abstained) {
        abstained += 1;
      }
      perIcon.set(slot.index, icon);
    }
  }
  const icons = [...perIcon.values()].sort((a, b) => a.index - b.index).map(icon => ({
    ...icon,
    wrongIds: Object.fromEntries([...icon.wrongIds.entries()].sort((a, b) => b[1] - a[1])),
    correctScoreRange: icon.correctScores.length
      ? { min: Math.min(...icon.correctScores), max: Math.max(...icon.correctScores), mean: icon.correctScores.reduce((a, b) => a + b, 0) / icon.correctScores.length }
      : null,
    correctScores: undefined,
  }));
  return {
    source: banGroundTruth.data.source ?? 'operator',
    sessionFrames: { from, to },
    banFilledFrom,
    totalSlotFrames: total,
    identified,
    correct,
    wrongIdentified,
    abstained,
    accuracy: total ? correct / total : null,
    identifiedRate: total ? identified / total : null,
    perIcon: icons,
    wrongDetails: wrongDetails.slice(0, 24),
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Format one candidate list compactly. */
function fmtCandidates(candidates) {
  return candidates.map(c => `${c.heroId}:${c.score.toFixed(3)}`).join(' ') || '-';
}

/** Print the per-slot table for one representative frame. */
function printFrameTable(frame) {
  console.log(`\nTabel per-slot untuk frame ${frame.index} (${frame.file}):`);
  console.log('  kind   side   idx  klasifikasi    heroId  score   top-3 kandidat');
  for (const slot of frame.slots) {
    const cls = slot.emptyCrop ? `${slot.classification} (crop kosong!)` : slot.classification;
    console.log(`  ${slot.kind.padEnd(6)} ${slot.side.padEnd(6)} ${String(slot.index).padStart(3)}  ${cls.padEnd(12)} ${slot.heroId === null ? 'null'.padStart(6) : String(slot.heroId).padStart(6)}  ${slot.score.toFixed(3)}   ${fmtCandidates(slot.candidates)}`);
  }
}

/** Print the human-readable Indonesian summary. */
function printSummary(report) {
  console.log('=== RINGKASAN EVALUASI VISION CORPUS ===');
  console.log(`Referensi hero  : ${report.meta.referenceCount}`);
  console.log(`Profil          : ${report.meta.profileVersion} (kalibrasi ${report.meta.profileResolution}, frame ${report.meta.frameResolution})`);
  console.log(`Frame diproses  : ${report.meta.framesProcessed} OK, ${report.meta.framesFailed} gagal dekode`);
  console.log(`Rentang frame   : ${report.meta.frameRange.from}..${report.meta.frameRange.to}`);
  console.log(`Ambang matcher  : minScore=${report.meta.minScore}, minMargin=${report.meta.minMargin}`);
  if (report.meta.captureScale !== undefined && report.meta.captureScale !== 1) {
    console.log(`Skala tangkapan : ${report.meta.captureScale} (frame di-downscale ke ${report.meta.frameResolution ?? '?'})`);
  }
  if (report.meta.frameRanges?.length) {
    console.log(`Rentang ukur    : ${report.meta.frameRanges.map(range => `${range.from}-${range.to}`).join(', ')}`);
    if (report.meta.excludedRanges?.length) {
      console.log(`Frame dikecualikan: ${report.meta.excludedRanges.map(range => `${range.from}-${range.to}`).join(', ')}`);
    }
  }

  const ab = report.metrics.abstention;
  console.log(`\nAbstensi        : ${ab.unidentified}/${ab.totalSlotFrames} slot-frame = ${ab.abstentionRate === null ? '-' : (ab.abstentionRate * 100).toFixed(1)}%`);
  console.log(`  (filled=${ab.filled}, empty=${ab.empty}, unidentified=${ab.unidentified})`);
  const banStat = ab.byKind?.ban;
  if (banStat) {
    // Explicit ban identification rate: the live path matches ban crops with
    // kind:'ban' — the circle-masked ban strategy when references carry
    // full64 (thresholds banMinScore=0.72 / banMinMargin=0.10, measured against
    // the operator-supplied ban ground truth), else the legacy legacy stricter
    // path. Identification and abstention are both reported here.
    console.log(`  Identifikasi ban: ${banStat.filled}/${banStat.totalSlotFrames} slot-frame ban teridentifikasi (${banStat.identifiedRate === null ? '-' : (banStat.identifiedRate * 100).toFixed(1)}%), abstain ${banStat.unidentified}/${banStat.totalSlotFrames} (${banStat.abstentionRate === null ? '-' : (banStat.abstentionRate * 100).toFixed(1)}%), kosong ${banStat.empty} — ambang ban matcher (0.72/0.10, terukur dari ground truth ban)`);
  }
  const pickStat = ab.byKind?.pick;
  if (pickStat) {
    console.log(`  Identifikasi pick: ${pickStat.filled}/${pickStat.totalSlotFrames} slot-frame pick teridentifikasi (${pickStat.identifiedRate === null ? '-' : (pickStat.identifiedRate * 100).toFixed(1)}%), abstain ${pickStat.unidentified}/${pickStat.totalSlotFrames}, kosong ${pickStat.empty}`);
  }
  const preFill = ab.presumedEmptyWindow;
  console.log(`  jendela pra-isi (slot dianggap kosong sebelum observasi filled pertama): ${preFill.slotFrames} slot-frame, abstensi ${preFill.slotFrames === 0 ? '-' : `${(preFill.abstentionRate * 100).toFixed(1)}%`}`);
  console.log('  CATATAN: jendela pra-isi adalah asumsi (isi pertama ≠ waktu kunci terdokumentasi).');

  console.log('\nStabilitas temporal per slot (worst dulu; null = < 2 frame filled):');
  for (const slot of report.metrics.temporalStability.slice(0, 10)) {
    const pct = slot.stability === null ? 'null' : `${(slot.stability * 100).toFixed(1)}%`;
    console.log(`  ${slot.slot.padEnd(12)} filled=${String(slot.filledFrames).padStart(3)}  stabilitas=${pct}`);
  }

  const changes = report.metrics.changePoints;
  console.log(`\nPerubahan hero terdeteksi: ${changes.length} (harusnya hanya di sekitar frame kunci terdokumentasi)`);
  for (const change of changes.slice(0, 12)) {
    const flag = change.withinOneFrameOfLock ? 'OK' : 'TIDAK-DEKAT-KUNCI';
    console.log(`  frame ${change.frame} ${change.slot}: ${change.from} -> ${change.to} (kunci terdekat: frame ${change.nearestDocumentedLock?.frame} jarak ${change.nearestDocumentedLock?.distance}) [${flag}]`);
  }
  if (changes.length > 12) console.log(`  ... dan ${changes.length - 12} perubahan lain (lihat laporan JSON).`);

  const dup = report.metrics.duplicates;
  console.log(`\nCek duplikat    : ${dup.violations.length} pelanggaran di ${dup.checkedFrames} frame fase PICK (hero tidak boleh terpick dua kali; khusus slot pick — identitas ban estime tidak dihitung)`);

  const banId = report.metrics.banIdentity;
  if (banId) {
    console.log(`\nIdentitas ban vs ground truth operator (frame ${banId.banFilledFrom}+):`);
    console.log(`  Akurasi        : ${banId.correct}/${banId.totalSlotFrames} slot-frame ban benar = ${banId.accuracy === null ? '-' : (banId.accuracy * 100).toFixed(1)}%`);
    console.log(`  Teridentifikasi: ${banId.identified}/${banId.totalSlotFrames} (${banId.identifiedRate === null ? '-' : (banId.identifiedRate * 100).toFixed(1)}%), benar ${banId.correct}, salah identifikasi ${banId.wrongIdentified}, abstain ${banId.abstained}`);
    for (const icon of banId.perIcon) {
      const range = icon.correctScoreRange;
      const scoreText = range ? `${range.mean.toFixed(3)} (min ${range.min.toFixed(3)})` : '-';
      const wrongText = Object.entries(icon.wrongIds).slice(0, 2).map(([id, count]) => `${id}(${count})`).join(' ') || '-';
      console.log(`  slot ${String(icon.index).padStart(2)} ${icon.side.padEnd(4)} GT ${String(icon.expectedHeroId).padStart(3)} ${icon.expectedHeroName.padEnd(8)} benar ${icon.correct}/${icon.frames} | skor benar ${scoreText} | salah: ${wrongText}`);
    }
    if (banId.wrongDetails.length) {
      console.log('  Detail salah identifikasi (maks 24):');
      for (const detail of banId.wrongDetails) {
        console.log(`   frame ${detail.frame} slot ${detail.slot}: dapat ${detail.got} (skor ${detail.score.toFixed(3)}), seharusnya ${detail.expected}`);
      }
    }
  } else {
    console.log('\nIdentitas ban  : tanpa ground truth (fixture ban-identity-ground-truth.json tidak ditemukan) — hanya tingkat identifikasi agregat di atas.');
  }

  const tableFrame = report.perFrame.find(frame => frame.index === report.meta.representativeFrame);
  if (tableFrame && tableFrame.slots.length) printFrameTable(tableFrame);

  console.log('\nLaporan JSON    : ' + report.meta.reportPath);
  if (banId) {
    console.log('CATATAN: ground truth ban hanya mencakup DRAFT #1 (dari operator); slot pick memakai ground truth hero-identity-ground-truth.json; identitas ban live tetap estimated/soft.');
  } else {
    console.log('PERINGATAN: belum ada ground-truth identitas hero — metrik di atas mengukur stabilitas & konsistensi, BUKAN kebenaran id hero.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.h) {
    printHelp();
    process.exit(0);
  }

  const corpusDir = resolvePath(options.corpus ?? '');
  if (!existsSync(corpusDir)) fail(`Folder corpus tidak ditemukan: ${options.corpus}. Gunakan --corpus D:\\hok-draft-engine\\data\\vision-corpus`);

  const profile = loadProfile(options.profile ? resolvePath(options.profile) : '');
  const annotations = loadAnnotations(options.annotations ? resolvePath(options.annotations) : '');
  const references = await loadReferences(resolvePath(options.reference ?? ''));
  const banGroundTruth = loadBanGroundTruth(options['ban-gt']
    ? resolvePath(options['ban-gt'])
    : join(THIS_DIR, '..', 'tests', 'fixtures', 'vision', 'ban-identity-ground-truth.json'));

  const minScore = Number(options['min-score'] ?? 0.55);
  const minMargin = Number(options['min-margin'] ?? 0.04);
  const matcher = new HeroMatcher(references, { minScore, minMargin });
  const captureScale = Number(options.scale ?? 1);
  if (!Number.isFinite(captureScale) || captureScale <= 0 || captureScale > 1) {
    fail(`Opsi --scale harus berada di (0, 1] (faktor downscale frame), bukan "${options.scale ?? ''}".`);
  }

  const from = Number.isFinite(Number(options.from)) ? Number(options.from) : annotations.contentFrames.from;
  const to = Number.isFinite(Number(options.to)) ? Number(options.to) : annotations.contentFrames.to;
  // --ranges overrides --from/--to; --exclude drops overlay/transition frames.
  const rangeList = options.ranges ? parseRanges(options.ranges, '--ranges') : [{ from, to }];
  const exclusions = options.exclude ? parseRanges(options.exclude, '--exclude') : [];

  const manifest = loadManifest(corpusDir);
  const inWindow = manifest.filter(entry => entry.index >= from && entry.index <= to);
  const selected = inWindow
    .filter(entry => inRanges(entry.index, rangeList) && !inRanges(entry.index, exclusions))
    .map(entry => ({ index: entry.index, file: entry.file, path: join(corpusDir, entry.file) }))
    .filter(entry => existsSync(entry.path));
  const missing = inWindow.filter(entry => inRanges(entry.index, rangeList) && !inRanges(entry.index, exclusions)).length - selected.length;
  if (selected.length === 0) {
    fail(`Tidak ada frame dalam rentang ${options.ranges ?? `${from}..${to}`} yang berkasnya ada di ${corpusDir}.`);
  }
  if (missing > 0) console.error(`Peringatan: ${missing} frame dalam rentang dilewati karena berkasnya tidak ada.`);

  const frames = selected.map(entry => ({ ...entry, bytes: readFileSync(entry.path) }));
  const perFrame = evaluateFrames(frames, profile, matcher, captureScale);

  // Representative frame: --frame wins; else the last frame of the last
  // requested range (for --ranges runs), else the last PICK frame from the
  // legacy annotations phases.
  const lastRangeEnd = rangeList[rangeList.length - 1].to;
  const legacyPickEnd = Math.max(...(annotations.phases ?? []).filter(p => String(p.phase).startsWith('PICK')).map(p => p.to), -Infinity);
  const representativeFrame = Number.isFinite(Number(options.frame))
    ? Number(options.frame)
    : (options.ranges ? lastRangeEnd : (Number.isFinite(legacyPickEnd) ? legacyPickEnd : lastRangeEnd));

  const stability = computeStability(perFrame);
  const report = {
    meta: {
      corpus: corpusDir,
      profilePath: resolvePath(options.profile),
      profileVersion: profile.version ?? '(tanpa version)',
      profileResolution: `${profile.resolution.width}x${profile.resolution.height}`,
      frameResolution: perFrame.find(frame => frame.resolution)?.resolution ?? null,
      referenceDir: resolvePath(options.reference),
      referenceCount: references.length,
      matcherReferenceCount: matcher.referenceCount,
      matcherBanReferenceCount: matcher.banReferenceCount,
      banGroundTruthPath: banGroundTruth ? resolvePath(options['ban-gt'] ?? join(THIS_DIR, '..', 'tests', 'fixtures', 'vision', 'ban-identity-ground-truth.json')) : null,
      frameRange: { from, to },
      framesProcessed: perFrame.filter(frame => !frame.error).length,
      framesFailed: perFrame.filter(frame => frame.error).length,
      minScore,
      minMargin,
      captureScale,
      representativeFrame,
      reportPath: null,
    },
    perFrame,
    metrics: {
      temporalStability: stability,
      changePoints: computeChangePoints(stability, annotations.locks),
      duplicates: computeDuplicates(perFrame, annotations.phases ?? [], Boolean(options.ranges)),
      abstention: computeAbstention(perFrame),
      banIdentity: computeBanIdentity(perFrame, banGroundTruth),
    },
  };

  const outPath = options.out ? resolvePath(options.out) : join(tmpdir(), 'hok-vision-eval-report.json');
  report.meta.reportPath = outPath;
  report.meta.frameRanges = rangeList;
  report.meta.excludedRanges = exclusions;
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  printSummary(report);

  const failed = perFrame.filter(frame => frame.error);
  if (failed.length) {
    console.log(`\nFrame yang gagal dekode (${failed.length}): ${failed.slice(0, 6).map(frame => `${frame.index} (${frame.error})`).join('; ')}${failed.length > 6 ? ' ...' : ''}`);
  }
}

main().catch(error => {
  console.error(`GALAT tak terduga: ${error?.stack ?? error}`);
  process.exit(1);
});
