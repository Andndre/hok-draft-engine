#!/usr/bin/env node
/**
 * Corpus H.264 fidelity tool — measures how much a scrcpy-style live capture
 * path (downscale -> H.264 encode -> decode) degrades the vision-corpus frames
 * BEFORE the matcher runs, and produces compressed corpus directories that
 * `evaluate-vision-corpus.mjs` can consume unchanged.
 *
 * For every requested corpus frame and every variant it:
 *   1. encodes the raw PNG to H.264 with settings standing in for scrcpy's
 *      defaults (libx264, yuv420p/4:2:0, limited range, 8 Mbps, veryfast),
 *      looping the still frame for 1 s @ 60 fps so x264 reaches steady-state
 *      rate control (the last decoded frame is mid-GOP, like real live video),
 *   2. decodes that H.264 back to a PNG,
 *   3. writes a variant corpus dir (`--out/<variant>/`) with a manifest.jsonl
 *      compatible with evaluate-vision-corpus.mjs (run it with --scale 1.0 —
 *      the frames already carry the variant's resolution),
 *   4. computes per-slot pixel deltas (mean absolute diff + NCC on grayscale
 *      crops from the calibrated RegionProfile) between the raw frame and the
 *      compressed frame at the resolution the matcher would actually see.
 *      For downscaled variants the "raw" reference is a pure-resize decode of
 *      the same frame through the same ffmpeg scaler, so the delta isolates
 *      H.264 damage from resampling.
 *
 * ffmpeg is invoked as an external process (no npm dependency). PNG decoding
 * and grayscale math reuse scripts/png-decode.mjs and src/vision/geometry.ts
 * exactly like evaluate-vision-corpus.mjs does.
 *
 * Usage (from apps/web):
 *   node scripts/h264-fidelity.mjs \
 *     --corpus ..\..\data\vision-corpus \
 *     --profile tests\fixtures\vision\region-profile-2800x1260.json \
 *     --frames "30,45,65,74" \
 *     --out "$env:TEMP\opencode\h264-fidelity" \
 *     [--ffmpeg C:\path\to\ffmpeg.exe] [--bitrate 8M] [--fps 60]
 *     [--variants "A@1.0,B@1920x864,C@1400x630"]
 */
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('../tests/typescript-loader.mjs', import.meta.url));
const { decodePng } = await import('./png-decode.mjs');
const { toGray, cropGray } = await import('../src/vision/geometry.ts');

const THIS_DIR = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`GALAT: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) options[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = argv[++i];
    else options[arg.slice(2)] = 'true';
  }
  return options;
}

function runFfmpeg(ffmpeg, args, label) {
  try {
    execFileSync(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (error) {
    const stderr = (error.stderr?.toString() ?? '').split('\n').slice(-8).join('\n');
    fail(`ffmpeg gagal (${label}):\n${stderr || error.message}`);
  }
}

/** Default variant set mirroring the operator's scrcpy window sizes. */
function defaultVariants() {
  return [
    { id: 'A', scale: '1.0', note: 'native 2800x1260 H.264 round-trip (scrcpy --max-size 0 default)' },
    { id: 'B', scale: '1920x864', note: 'downscale ke 1920x864 dulu, lalu H.264 (jendela ~1080p)' },
    { id: 'C', scale: '1400x630', note: 'downscale ke 1400x630 dulu, lalu H.264 (jendela kecil)' },
  ];
}

function parseVariantSpec(spec) {
  const variants = [];
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf('@');
    if (at < 1) fail(`Variant tidak valid: "${trimmed}" (harus "ID@skala", skala "1.0" atau "WxH").`);
    const id = trimmed.slice(0, at);
    const scale = trimmed.slice(at + 1);
    if (!/^[0-9.]+$/.test(scale) && !/^\d+x\d+$/.test(scale)) fail(`Skala variant tidak valid: ${scale}`);
    variants.push({ id, scale });
  }
  return variants;
}

/** ffmpeg -vf fragment for a variant's scale (empty for 1.0). */
function scaleFilter(scale) {
  const match = /^(\d+)x(\d+)$/.exec(scale);
  if (match) {
    const [, w, h] = match;
    if (Number(w) % 2 !== 0 || Number(h) % 2 !== 0) fail(`Ukuran ${w}x${h} harus genap untuk yuv420p.`);
    return `scale=${w}:${h}:flags=bicubic`;
  }
  const factor = Number(scale);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1) fail(`Skala tidak valid: ${scale}`);
  if (factor === 1) return null;
  return `scale=iw*${factor}:ih*${factor}:flags=bicubic`;
}

/** Mean absolute difference (0-255 scale) between two equal-size Float32 grays. */
function meanAbsDiff(a, b) {
  let sum = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 1) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

/** Pearson/NCC over gray values of two equal-size grays. */
function ncc(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  if (n === 0) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a.data[i]; mb += b.data[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a.data[i] - ma, db = b.data[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return cov === 0 ? 1 : null;
  return cov / Math.sqrt(va * vb);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpusDir = resolvePath(options.corpus ?? '');
  const profilePath = resolvePath(options.profile ?? '');
  const outDir = resolvePath(options.out ?? '');
  const ffmpeg = resolvePath(options.ffmpeg ?? 'ffmpeg.exe');
  const bitrate = options.bitrate ?? '8M';
  const fps = options.fps ?? '60';
  const framesSpec = options.frames ?? '';
  if (!existsSync(corpusDir)) fail(`Corpus tidak ada: ${corpusDir}`);
  if (!existsSync(profilePath)) fail(`Profil tidak ada: ${profilePath}`);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(ffmpeg)) fail(`ffmpeg tidak ditemukan: ${ffmpeg} (beri --ffmpeg).`);

  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  const frameIndexes = framesSpec.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (frameIndexes.length === 0) fail('Beri --frames "30,45,65,74".');

  const manifestPath = join(corpusDir, 'manifest.jsonl');
  if (!existsSync(manifestPath)) fail(`manifest.jsonl tidak ada di ${corpusDir}`);
  const entries = [];
  for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      entries.push({ index: Number(record.index), file: record.file, resolution: String(record.resolution ?? '') });
    } catch { /* skip malformed line */ }
  }
  const selected = frameIndexes
    .map(index => entries.find(entry => entry.index === index))
    .map(entry => {
      if (!entry) fail(`Frame index tidak ada di manifest: ${frameIndexes.join(',')}`);
      const path = join(corpusDir, entry.file);
      if (!existsSync(path)) fail(`File frame tidak ada: ${path}`);
      return { ...entry, path };
    });

  const variants = options.variants ? parseVariantSpec(options.variants) : defaultVariants();
  const workDir = join(outDir, '_work');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const pixelReport = { generatedBy: 'h264-fidelity.mjs', profile: profile.version ?? profilePath, bitrate, fps, frames: [], variants: [] };
  const summaryRows = [];

  for (const variant of variants) {
    const vf = scaleFilter(variant.scale);
    const variantDir = join(outDir, `variant${variant.id}`);
    rmSync(variantDir, { recursive: true, force: true });
    mkdirSync(variantDir, { recursive: true });

    const decoded = new Map(); // index -> { pngPath, size }
    const purePaths = new Map(); // index -> pure-resize reference png (untuk B/C)
    for (const entry of selected) {
      const clip = join(workDir, `${variant.id}_${entry.index}.mp4`);
      const encArgs = ['-y', '-loop', '1', '-framerate', fps, '-t', '1', '-i', entry.path];
      if (vf) encArgs.push('-vf', vf);
      encArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-an', clip);
      runFfmpeg(ffmpeg, encArgs, `encode variant${variant.id} frame${entry.index}`);

      const outPng = join(variantDir, entry.file);
      runFfmpeg(ffmpeg, ['-y', '-i', clip, '-vf', `select=gte(n\\,${Number(fps) - 1})`, '-fps_mode', 'vfr', '-frames:v', '1', outPng],
        `decode variant${variant.id} frame${entry.index}`);
      decoded.set(entry.index, { pngPath: outPng });

      if (vf) {
        const pure = join(workDir, `pure${variant.id}_${entry.index}.png`);
        runFfmpeg(ffmpeg, ['-y', '-i', entry.path, '-vf', vf, '-frames:v', '1', pure], `pure-resize variant${variant.id} frame${entry.index}`);
        purePaths.set(entry.index, pure);
      }
    }

    // manifest.jsonl compatible with evaluate-vision-corpus.mjs;
    // resolution dihitung dari PNG hasil decode agar akurat:
    const manifestFinal = [];
    for (const entry of selected) {
      const png = decoded.get(entry.index).pngPath;
      const size = decodedPngSize(png);
      manifestFinal.push(JSON.stringify({ index: entry.index, file: entry.file, resolution: `${size.width}x${size.height}`, variant: variant.id, sourceResolution: entry.resolution }));
    }
    writeFileSync(join(variantDir, 'manifest.jsonl'), manifestFinal.join('\n') + '\n', 'utf8');

    // Pixel deltas per slot: raw (atau pure-resize utk B/C) vs compressed.
    const variantFrameReports = [];
    let worst = { mad: -1 };
    for (const entry of selected) {
      const refPath = purePaths.get(entry.index) ?? entry.path;
      const refGray = toGray(decodePng(readFileSync(refPath)));
      const compGray = toGray(decodePng(readFileSync(decoded.get(entry.index).pngPath)));
      if (refGray.width !== compGray.width || refGray.height !== compGray.height) {
        fail(`Ukuran referensi (${refGray.width}x${refGray.height}) != hasil decode (${compGray.width}x${compGray.height}) pada variant ${variant.id} frame ${entry.index}.`);
      }
      const scaleX = compGray.width / profile.resolution.width;
      const scaleY = compGray.height / profile.resolution.height;
      const slots = profile.slots.map(slot => {
        const rect = { x: slot.rect.x * scaleX, y: slot.rect.y * scaleY, w: slot.rect.w * scaleX, h: slot.rect.h * scaleY };
        const cropRef = cropGray(refGray, rect);
        const cropComp = cropGray(compGray, rect);
        const mad = meanAbsDiff(cropRef, cropComp);
        const corr = ncc(cropRef, cropComp);
        const row = { slot: slot.index, side: slot.side, kind: slot.kind, mad: Number(mad.toFixed(3)), madPct: Number(((mad / 255) * 100).toFixed(2)), ncc: corr === null ? null : Number(corr.toFixed(5)) };
        if (mad > worst.mad) worst = { ...row, frame: entry.index };
        return row;
      });
      variantFrameReports.push({ frame: entry.index, slots });
    }
    pixelReport.variants.push({ id: variant.id, scale: variant.scale, frames: variantFrameReports });
    const mads = variantFrameReports.flatMap(f => f.slots.map(s => s.mad));
    const nccs = variantFrameReports.flatMap(f => f.slots.map(s => s.ncc).filter(v => v !== null));
    summaryRows.push({
      variant: variant.id, size: variant.scale,
      meanMad: Number((mads.reduce((a, b) => a + b, 0) / mads.length).toFixed(3)),
      worstMad: worst.mad, worstSlot: `${worst.side}/${worst.kind}/${worst.slot} (frame ${worst.frame})`,
      minNcc: Number(Math.min(...nccs).toFixed(5)),
    });
    console.log(`variant${variant.id} selesai: ${selected.length} frame, rata-rata MAD=${summaryRows[summaryRows.length - 1].meanMad}, worst=${worst.mad} @ ${worst.side}/${worst.kind}/${worst.slot}, minNCC=${summaryRows[summaryRows.length - 1].minNcc}`);
  }

  pixelReport.summary = summaryRows;
  const reportPath = join(outDir, 'pixel-deltas.json');
  writeFileSync(reportPath, JSON.stringify(pixelReport, null, 2), 'utf8');
  console.log(`\nTabel ringkas (per variant, semua frame+slot):`);
  for (const row of summaryRows) {
    console.log(`  variant${row.variant} [${row.size}]  meanMAD=${row.meanMad}  worstMAD=${row.worstMad} (${row.worstSlot})  minNCC=${row.minNcc}`);
  }
  console.log(`Laporan piksel : ${reportPath}`);
  console.log(`Folder corpus per variant (pakai --corpus ini di evaluate-vision-corpus.mjs, --scale 1.0):`);
  for (const variant of variants) console.log(`  ${join(outDir, `variant${variant.id}`)}`);
}

function decodedPngSize(pngPath) {
  const bytes = readFileSync(pngPath);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

main().catch(error => {
  console.error(`GALAT tak terduga: ${error?.stack ?? error}`);
  process.exit(1);
});
