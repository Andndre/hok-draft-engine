"""Calibrate a RegionProfile for the HoK Global RANKED draft screen (2800x1260).

Reads the captured corpus (data/vision-corpus, gitignored), a reference PNG set
from convert_reference_images.py, and emits:
  1. a RegionProfile JSON (16 slots + anchors) for apps/web regionMap embedding;
  2. a sibling ``<out>.fillorder.json`` report: per-slot first non-blank frame
     (runtime blank rule, std > 4.0), first chevron-lock frame, per-slot
     stability/score, frame-78 identity check against
     apps/web/tests/fixtures/vision/hero-identity-ground-truth.json,
     column-colour verification (left column must read RED = ownSide), and
     anchor presence stats.

Determinism contract: every image primitive here mirrors
apps/web/src/vision/geometry.ts BIT FOR BIT (Rec.601 rounding, bilinear
resizeGray, normalizeGray, aspectFit, 9x8 dHash, Pearson ncc with the 1e-9
guard) and HeroMatcher.match() INCLUDING the zoom-candidate search added in
this lane (see zoom_candidates — MUST stay in lockstep with heroMatcher.ts).

IMPORTANT decoder note: apps/web/scripts/png-decode.mjs applies the Paeth
filter's upper-left reference as the LAST pixel of the previous scanline at
scanline start, which corrupts whole Paeth-filtered rows (Pillow/libpng treat
out-of-range references as zero). Scripts/** is out of this lane's scope, so
this script re-saves the *derived* reference PNGs (--reference dir, temp
artifacts) with PNG filter type 0 so the Node harness decodes them byte-exactly,
and documents that the raw corpus frames remain affected there (run the harness
against the filter-0 derived corpus copy for valid numbers).

Run (numpy injected on demand; a plain ``uv run`` re-execs itself):

    cd packages/ml-engine
    uv run --with numpy calibrate_vision_regions.py \
        --corpus D:\\hok-draft-engine\\data\\vision-corpus \
        --reference C:\\...\\ref-png \
        --out D:\\hok-draft-engine\\apps\\web\\tests\\fixtures\\vision\\region-profile-2800x1260.json

Flags: --corpus --reference --out --version --min-score --min-margin
       --frames (explicit verification frame range, e.g. "28-78")
       --no-refilter-references --no-self-check --verbose
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


def _ensure_numpy() -> None:
    """Re-exec through `uv run --with numpy` when numpy is missing (Windows-safe)."""
    try:
        import numpy  # noqa: F401
        return
    except ImportError:
        pass
    uv = shutil.which("uv")
    if uv:
        cmd = [uv, "run", "--with", "numpy", str(Path(__file__).resolve()), *sys.argv[1:]]
        print("numpy tidak ada di env proyek; re-exec: uv run --with numpy ...", file=sys.stderr)
        raise SystemExit(subprocess.run(cmd, cwd=str(Path(__file__).resolve().parent)).returncode)
    print("GALAT: numpy dibutuhkan. Jalankan: uv run --with numpy calibrate_vision_regions.py ...", file=sys.stderr)
    raise SystemExit(2)


_ensure_numpy()

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GROUND_TRUTH = ROOT / "apps/web/tests/fixtures/vision/hero-identity-ground-truth.json"

# --- Screen anatomy (2800x1260, second-pass measurements, ±2 px) -------------
# Left column = operator's OWN team; right column = opponent. Slot `side`
# values describe THIS captured session (left = red, right = blue); runtime
# mirroring against the operator's declared side lives in regionMap.ts.
RED_COLUMN_BAND = (150, 125, 495, 1020)    # x, y, w, h — own-team column band
BLUE_COLUMN_BAND = (2320, 130, 335, 975)   # opponent column band
BANNER_TEXT_RECT = (1125, 41, 549, 42)     # "Fase Ban" / "Pilih Hero" / "Penyesuaian Terakhir"
SKILL_BUTTON_RECT = (2030, 15, 175, 75)    # "Keahlian" (ban) / "Skill ^" (pick) — covers both labels
LEFT_BAN_STRIP = (165, 8, 255, 80)
RIGHT_BAN_STRIP = (2385, 8, 250, 80)
BOTTOM_BUTTON_ROW_RECT = (160, 1130, 800, 90)
CENTRE_MODEL_RECT = (1150, 55, 640, 1050)  # NEGATIVE control: 3D hero model, not a slot

# Measured seed rects (frame 074, all 10 picks + 6 bans filled).
PICK_ROW_Y = (137, 340, 543, 746, 950)
PICK_SEEDS_RED = [(183, y, 147, 147) for y in PICK_ROW_Y]   # left column rows 1..5
PICK_SEEDS_BLUE = [(2485, y, 146, 147) for y in PICK_ROW_Y]  # right column rows 1..5
BAN_SEEDS_RED = [(173, 15, 64, 64), (258, 15, 64, 64), (345, 15, 64, 64)]
BAN_SEEDS_BLUE = [(2391, 14, 66, 64), (2478, 14, 66, 64), (2564, 14, 66, 64)]
# Lock badge overlaps the bottom-centre of the tile: (x+38, y+118, 71, 55) left, (x+37, ...) right.
BADGE_OFFSET_RED = (38, 118, 71, 55)
BADGE_OFFSET_BLUE = (37, 118, 71, 55)

BAN_WINDOW = (28, 36)
PICK_WINDOW = (37, 78)
LOBBY_WINDOW = (1, 27)

BLANK_STD_THRESHOLD = 4.0   # == pipeline.ts BLANK_SLOT_STD_THRESHOLD
BADGE_TRIM_RATIO = 0.80     # lock badge covers the bottom ~20% of the tile
ZOOM_DX_OFFSETS = (-4, 0, 4)
ZOOM_SCALES = (0.9, 0.8, 0.7, 0.62)
ZOOM_DY_RATIOS = (0.0, 0.06, -0.06)
SHORTLIST_SIZE = 12         # HeroMatcher DEFAULTS.shortlistSize


# =============================================================================
# Geometry — bit-for-bit mirror of apps/web/src/vision/geometry.ts
# =============================================================================

def to_gray_rgb(rgb: np.ndarray) -> np.ndarray:
    """Rec.601 luminance of an (h, w, 3) uint8 array; Math.round == floor(x+0.5)."""
    r = rgb[:, :, 0].astype(np.float64)
    g = rgb[:, :, 1].astype(np.float64)
    b = rgb[:, :, 2].astype(np.float64)
    return np.floor((r * 299 + g * 587 + b * 114) / 1000 + 0.5).astype(np.float32)


def resize_gray(src: np.ndarray, width: int, height: int) -> np.ndarray:
    """Bilinear, edge-clamped, unrounded — identical indexing to resizeGray."""
    sh, sw = src.shape
    w, h = max(0, int(width)), max(0, int(height))
    if w == 0 or h == 0 or sw == 0 or sh == 0:
        return np.zeros((h, w), dtype=np.float32)
    if w == sw and h == sh:
        return src.astype(np.float32).copy()
    data = src.astype(np.float64)
    xs = np.clip((np.arange(w, dtype=np.float64) + 0.5) * (sw / w) - 0.5, 0, sw - 1)
    ys = np.clip((np.arange(h, dtype=np.float64) + 0.5) * (sh / h) - 0.5, 0, sh - 1)
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    x1 = np.minimum(x0 + 1, sw - 1)
    y1 = np.minimum(y0 + 1, sh - 1)
    fx = (xs - x0)[None, :]
    fy = (ys - y0)[:, None]
    top = data[np.ix_(y0, x0)] + (data[np.ix_(y0, x1)] - data[np.ix_(y0, x0)]) * fx
    bottom = data[np.ix_(y1, x0)] + (data[np.ix_(y1, x1)] - data[np.ix_(y1, x0)]) * fx
    return (top + (bottom - top) * fy).astype(np.float32)


def normalize_gray(img: np.ndarray) -> np.ndarray:
    """Zero-mean / unit-variance (population); std < 1e-6 maps to all zeros."""
    out = np.zeros(img.shape, dtype=np.float32)
    if img.size == 0:
        return out
    data = img.astype(np.float64)
    mean = data.mean()
    std = math.sqrt(float(np.square(data - mean).sum() / data.size))
    if std < 1e-6:
        return out
    return ((data - mean) / std).astype(np.float32)


def aspect_fit(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """Letterbox onto a zero background preserving aspect (Math.round rounding)."""
    w, h = max(0, int(width)), max(0, int(height))
    out = np.zeros((h, w), dtype=np.float32)
    if w == 0 or h == 0 or img.size == 0:
        return out
    sh, sw = img.shape
    scale = min(w / sw, h / sh)
    rw = max(1, math.floor(sw * scale + 0.5))
    rh = max(1, math.floor(sh * scale + 0.5))
    resized = resize_gray(img, rw, rh)
    out[(h - rh) // 2:(h - rh) // 2 + rh, (w - rw) // 2:(w - rw) // 2 + rw] = resized
    return out


def d_hash(img: np.ndarray) -> int:
    """64-bit difference hash on a 9x8 grid; bit (y*8+x) set when grid[y][x] > grid[y][x+1]."""
    grid = resize_gray(img, 9, 8)
    bits = 0
    for y in range(8):
        for x in range(8):
            if grid[y, x] > grid[y, x + 1]:
                bits |= 1 << (y * 8 + x)
    return bits


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count("1")


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    """Pearson r in [-1, 1]; 0 for degenerate or size-mismatched input."""
    if a.shape != b.shape:
        return 0.0
    if a.size == 0:
        return 0.0
    fa = a.astype(np.float64).ravel()
    fb = b.astype(np.float64).ravel()
    ma, mb = fa.mean(), fb.mean()
    cov = float(((fa - ma) * (fb - mb)).sum())
    va = float(((fa - ma) ** 2).sum())
    vb = float(((fb - mb) ** 2).sum())
    denom = math.sqrt(va * vb)
    if denom < 1e-9:
        return 0.0
    return float(min(1.0, max(-1.0, cov / denom)))


def crop_gray(src: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    """Clamped crop (x, y, w, h) -> (h, w) float32; zero-size when fully outside."""
    sh, sw = src.shape
    x, y, w, h = rect
    x0, y0 = max(0, math.floor(x)), max(0, math.floor(y))
    x1, y1 = min(sw, math.ceil(x + w)), min(sh, math.ceil(y + h))
    cw, ch = max(0, x1 - x0), max(0, y1 - y0)
    if cw == 0 or ch == 0:
        return np.zeros((0, 0), dtype=np.float32)
    return src[y0:y1, x0:x1].astype(np.float32).copy()


def crop_std(crop: np.ndarray) -> float:
    """Population std on the 0..255 scale (pipeline.ts cropStd)."""
    if crop.size == 0:
        return 0.0
    data = crop.astype(np.float64)
    return float(math.sqrt(float(np.square(data - data.mean()).sum()) / data.size))


# =============================================================================
# Matcher — mirror of heroMatcher.ts incl. the zoom-candidate search
# =============================================================================

@dataclass
class RefEntry:
    hero_id: int
    hash: int
    thumb: np.ndarray     # normalized 32x32 aspect-fit (as referenceSet.ts)
    prepared: np.ndarray  # normalized 64x64 of thumb (NCC comparison target)


def _centred_subcrop(source: np.ndarray, scale: float, dy_ratio: float) -> np.ndarray:
    ssh, ssw = source.shape
    cw = max(8, math.floor(ssw * scale + 0.5))
    ch = max(8, math.floor(ssh * scale + 0.5))
    dy = math.floor(ssh * dy_ratio + 0.5)
    x = (ssw - cw) // 2
    y = min(max((ssh - ch) // 2 + dy, 0), ssh - ch)
    return source[y:y + ch, x:x + cw].copy()


def zoom_candidates(crop: np.ndarray) -> list[np.ndarray]:
    """MUST stay in lockstep with heroMatcher.ts zoomCandidates(): same order.

    12 candidates over two axes (badge avoidance + zoom-in), on the
    badge-trimmed source first, then the full crop as fallback:
      - badge-trimmed (top 80%) at scale 1.0 with dx in (-4, 0, +4)
      - trimmed centred sub-crops at 0.9 / 0.8 with dy in (0, +6%, -6%)
      - trimmed centred sub-crops at 0.7 and 0.62 (dy 0)
      - full crop at scale 1.0
    """
    out: list[np.ndarray] = []
    sh, sw = crop.shape
    trim_h = max(1, math.floor(sh * BADGE_TRIM_RATIO))
    trimmed = crop[:trim_h, :] if trim_h < sh else crop
    for dx in ZOOM_DX_OFFSETS:
        out.append(crop_gray(trimmed, (dx, 0, trimmed.shape[1], trimmed.shape[0])))
    for scale in ZOOM_SCALES:
        for dy_ratio in (ZOOM_DY_RATIOS if scale >= 0.8 else (0.0,)):
            out.append(_centred_subcrop(trimmed, scale, dy_ratio))
    out.append(crop)
    return out


class Matcher:
    """Full mirror of HeroMatcher.match(): zoom search -> per-candidate dHash
    shortlist -> NCC ranking -> abstention on minScore/minMargin."""

    def __init__(self, refs: list[RefEntry], min_score: float = 0.55, min_margin: float = 0.04):
        self.refs = refs
        self.min_score = min_score
        self.min_margin = min_margin
        self.matrix = np.stack([r.prepared.ravel() for r in refs]) if refs else np.zeros((0, 4096), np.float32)

    def match(self, crop: np.ndarray) -> dict:
        if not self.refs or crop.size == 0:
            return {"hero_id": None, "score": 0.0, "abstained": True, "candidates": [], "best_candidate": None}
        best = None
        for cand_index, cand in enumerate(zoom_candidates(crop)):
            prepared = normalize_gray(aspect_fit(resize_gray(cand, 64, 64), 64, 64))
            hv = d_hash(prepared)
            order = sorted(range(len(self.refs)), key=lambda i: hamming(hv, self.refs[i].hash))[:SHORTLIST_SIZE]
            scored = [(i, ncc(prepared, self.refs[i].prepared)) for i in order]
            scored.sort(key=lambda t: -t[1])
            top_i, top_s = scored[0]
            margin = top_s - (scored[1][1] if len(scored) > 1 else 0.0)
            if best is None or top_s > best[0]:
                best = (top_s, top_i, margin, scored[:3], cand_index)
        score, idx, margin, top3, cand_index = best
        abstained = score < self.min_score or margin < self.min_margin
        return {
            "hero_id": None if abstained else self.refs[idx].hero_id,
            "score": score,
            "abstained": abstained,
            "candidates": [(self.refs[i].hero_id, s) for i, s in top3],
            "best_candidate": cand_index,
        }

    def fast_best_score(self, crop: np.ndarray) -> float:
        """Best NCC over ALL references for one prepared crop (refinement objective)."""
        if crop.size == 0 or not self.refs:
            return 0.0
        prepared = normalize_gray(aspect_fit(resize_gray(crop, 64, 64), 64, 64)).ravel()
        return float((self.matrix @ prepared).max() / prepared.size)


def build_references(ref_dir: Path) -> list[RefEntry]:
    """referenceSet.ts pipeline in Python: decode -> gray -> hash/thumb."""
    refs: list[RefEntry] = []
    for path in sorted(ref_dir.glob("*.png")):
        try:
            hero_id = int(path.stem)
        except ValueError:
            continue
        rgba = np.asarray(Image.open(path).convert("RGBA"))
        gray = to_gray_rgb(rgba[:, :, :3])
        small = resize_gray(gray, 32, 32)
        refs.append(RefEntry(
            hero_id=hero_id,
            hash=d_hash(normalize_gray(resize_gray(gray, 64, 64))),
            thumb=aspect_fit(normalize_gray(small), 32, 32),
            prepared=normalize_gray(resize_gray(aspect_fit(normalize_gray(small), 32, 32), 64, 64)),
        ))
    return refs


# =============================================================================
# PNG filter-0 re-encode (works around the png-decode.mjs Paeth-start bug)
# =============================================================================

def png_resave_filter0(path: Path) -> None:
    """Re-save one PNG as 8-bit RGBA with filter type 0 on every scanline."""
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    h, w = rgba.shape[:2]
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))
    idat = zlib.compress(raw, 6)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", idat)
    out += chunk(b"IEND", b"")
    tmp = path.with_suffix(".png.tmp")
    tmp.write_bytes(out)
    tmp.replace(path)


def refilter_references(ref_dir: Path, verbose: bool) -> int:
    """Re-save every reference PNG with filter 0 (Node decode == Pillow == browser)."""
    count = 0
    for path in sorted(ref_dir.glob("*.png")):
        try:
            int(path.stem)
        except ValueError:
            continue
        png_resave_filter0(path)
        count += 1
    if verbose:
        print(f"  {count} PNG referensi ditulis ulang dengan filter 0 (ampuh terhadap bug Paeth png-decode.mjs)")
    return count


# =============================================================================
# Self-check: Python vs TypeScript geometry through the repo's TS loader
# =============================================================================

def run_self_check(ref_dir: Path, verbose: bool) -> bool:
    """Compare dHash/ncc/resize + a real reference PNG against geometry.ts via node."""
    import tempfile

    rng = np.random.RandomState(42)
    images = []
    for shape in [(13, 20), (64, 64), (100, 137)]:
        images.append((rng.rand(*shape) * 255).astype(np.float32))
    images.append(np.full((9, 8), 42.0, dtype=np.float32))  # degenerate
    ncc_pairs = [(0, 1), (0, 0), (0, 3), (1, 2), (2, 3)]
    resizes = [(0, 64, 64), (1, 9, 8), (2, 32, 32), (2, 100, 60)]
    ref_png = sorted(ref_dir.glob("*.png"))[0] if ref_dir.exists() and any(ref_dir.glob("*.png")) else None

    inp = {
        "images": [{"width": i.shape[1], "height": i.shape[0], "data": i.ravel().tolist()} for i in images],
        "nccPairs": ncc_pairs,
        "resizes": [{"img": i, "w": w, "h": h} for i, w, h in resizes],
        "refPng": str(ref_png) if ref_png else None,
    }
    tmp_dir = Path(tempfile.gettempdir())
    inp_path, out_path = tmp_dir / "hok-selfcheck-in.json", tmp_dir / "hok-selfcheck-out.json"
    inp_path.write_text(json.dumps(inp), "utf8")

    script = ROOT / "apps/web/tests/_selfcheck_vision_tmp.mjs"
    script.write_text(
        "import { register } from 'node:module';\n"
        "import { readFileSync, writeFileSync } from 'node:fs';\n"
        "register(new URL('./typescript-loader.mjs', import.meta.url));\n"
        "const geom = await import('../src/vision/geometry.ts');\n"
        "const { decodePng } = await import('../scripts/png-decode.mjs');\n"
        "const inp = JSON.parse(readFileSync(process.argv[2], 'utf8'));\n"
        "const g = inp.images.map(i => ({ width: i.width, height: i.height, data: Float32Array.from(i.data) }));\n"
        "const out = { hashes: [], nccs: [], resizes: [] };\n"
        "for (const img of g) out.hashes.push(String(geom.dHash(geom.normalizeGray(geom.resizeGray(img, 64, 64)))));\n"
        "for (const [a, b] of inp.nccPairs) out.nccs.push(geom.ncc(g[a], g[b]));\n"
        "for (const r of inp.resizes) out.resizes.push(Array.from(geom.resizeGray(g[r.img], r.w, r.h).data, v => v));\n"
        "if (inp.refPng) { const ref = geom.toGray(decodePng(readFileSync(inp.refPng)));\n"
        "  out.refHash = String(geom.dHash(geom.normalizeGray(geom.resizeGray(ref, 64, 64))));\n"
        "  out.refThumb = Array.from(geom.aspectFit(geom.normalizeGray(geom.resizeGray(ref, 32, 32)), 32, 32).data, v => v); }\n"
        "writeFileSync(process.argv[3], JSON.stringify(out));\n",
        "utf8",
    )
    try:
        proc = subprocess.run(
            ["node", str(script), str(inp_path), str(out_path)],
            cwd=str(ROOT / "apps/web"), capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            print(f"SELF-CHECK GAGAL (node exit {proc.returncode}): {proc.stderr[-800:]}", file=sys.stderr)
            return False
        ts = json.loads(out_path.read_text("utf8"))
    finally:
        script.unlink(missing_ok=True)
        inp_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)

    ok = True

    def fail(msg: str) -> None:
        nonlocal ok
        ok = False
        print(f"SELF-CHECK GAGAL: {msg}", file=sys.stderr)

    py_hashes = [d_hash(normalize_gray(resize_gray(i, 64, 64))) for i in images]
    for i, (ph, th) in enumerate(zip(py_hashes, ts["hashes"])):
        if ph != int(th):
            fail(f"dHash#{i}: python={ph} ts={th}")
    for k, (a, b) in enumerate(ncc_pairs):
        if abs(ncc(images[a], images[b]) - ts["nccs"][k]) > 1e-6:
            fail(f"ncc#{k} ({a},{b}): python={ncc(images[a], images[b])} ts={ts['nccs'][k]}")
    for k, (i, w, h) in enumerate(resizes):
        diff = float(np.max(np.abs(resize_gray(images[i], w, h).ravel() - np.asarray(ts["resizes"][k], dtype=np.float64))))
        if diff > 1e-3:
            fail(f"resizeGray#{k} ({w}x{h}): max|diff|={diff}")
    if ref_png is not None:
        rgba = np.asarray(Image.open(ref_png).convert("RGBA"))
        ref_gray = to_gray_rgb(rgba[:, :, :3])
        if d_hash(normalize_gray(resize_gray(ref_gray, 64, 64))) != int(ts["refHash"]):
            fail(f"reference dHash mismatch for {ref_png.name}")
        thumb_diff = float(np.max(np.abs(
            aspect_fit(normalize_gray(resize_gray(ref_gray, 32, 32)), 32, 32).ravel()
            - np.asarray(ts["refThumb"], dtype=np.float64))))
        if thumb_diff > 1e-3:
            fail(f"reference thumb mismatch: max|diff|={thumb_diff}")
        if verbose:
            print(f"  self-check: referensi {ref_png.name} dHash+thumb cocok (thumb max|diff|={thumb_diff:.2e})")
    print("SELF-CHECK Python<->TypeScript: OK" if ok else "SELF-CHECK Python<->TypeScript: GAGAL")
    return ok


# =============================================================================
# Corpus loading
# =============================================================================

def load_manifest(corpus_dir: Path) -> dict[int, str]:
    entries: dict[int, str] = {}
    for line in (corpus_dir / "manifest.jsonl").read_text("utf8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            entries[int(rec["index"])] = rec["file"]
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
    return entries


class Corpus:
    """Frame cache as uint8 gray (memory-friendly) + colour probes."""

    def __init__(self, corpus_dir: Path, index_range: range):
        self.dir = corpus_dir
        self.manifest = load_manifest(corpus_dir)
        self.indexes = [i for i in index_range if i in self.manifest and (corpus_dir / self.manifest[i]).exists()]
        self._gray8: dict[int, np.ndarray] = {}
        self._band_stats: dict[int, dict] = {}
        self._badge_stats: dict[int, dict] = {}

    def _load(self, index: int) -> None:
        if index in self._gray8:
            return
        rgb = np.asarray(Image.open(self.dir / self.manifest[index]).convert("RGB"))
        self._gray8[index] = to_gray_rgb(rgb).astype(np.uint8)
        self._band_stats[index] = {
            "left": region_warm_cool(rgb, RED_COLUMN_BAND, return_sat=True),
            "right": region_warm_cool(rgb, BLUE_COLUMN_BAND, return_sat=True),
        }
        badges = {}
        for side, seeds, offset in (("red", PICK_SEEDS_RED, BADGE_OFFSET_RED), ("blue", PICK_SEEDS_BLUE, BADGE_OFFSET_BLUE)):
            per_row = []
            for (x, y, w, h) in seeds:
                bx, by, bw, bh = offset
                per_row.append(badge_strict_counts(rgb, (x + bx, y + by, bw, bh)))
            badges[side] = per_row
        self._badge_stats[index] = badges
        del rgb

    def crop(self, index: int, rect: tuple[int, int, int, int]) -> np.ndarray:
        self._load(index)
        return crop_gray(self._gray8[index].astype(np.float32), rect)

    def crop_std(self, index: int, rect: tuple[int, int, int, int]) -> float:
        return crop_std(self.crop(index, rect))

    def band_stats(self, index: int) -> dict:
        self._load(index)
        return self._band_stats[index]

    def badge_stats(self, index: int) -> dict:
        self._load(index)
        return self._badge_stats[index]


def region_warm_cool(rgb: np.ndarray, rect: tuple[int, int, int, int], return_sat: bool = False):
    """Count warm vs cool pixels by HUE (not intensity).

    The team tint is dim: red placeholders measure ~(63,23,33), blue ~(9,36,66),
    so an intensity gate (r/b >= 96) misses them entirely. Classification:
    chroma >= 16; warm = r >= g+12 and r >= b+12; cool = b >= g+12 and b >= r+12.
    MUST stay consistent with detectLeftColumnSide() in apps/web/vision/pipeline.ts.
    """
    x, y, w, h = rect
    sh, sw = rgb.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(sw, x + w), min(sh, y + h)
    if x1 <= x0 or y1 <= y0:
        return (0, 0, 0) if return_sat else (0, 0)
    px = rgb[y0:y1, x0:x1].astype(np.int16)
    chroma = px.max(axis=2) - px.min(axis=2)
    mask = chroma >= 16
    r, g, b = px[:, :, 0], px[:, :, 1], px[:, :, 2]
    warm = int(np.count_nonzero(mask & (r >= g + 12) & (r >= b + 12)))
    cool = int(np.count_nonzero(mask & (b >= g + 12) & (b >= r + 12)))
    sat_total = int(np.count_nonzero(mask))
    return (warm, cool, sat_total) if return_sat else (warm, cool)


# =============================================================================
# Slot refinement + verification
# =============================================================================

def refine_rect(corpus: Corpus, matcher: Matcher, seed: tuple[int, int, int, int],
                frames: Sequence[int], pos_range: int = 10, size_range: int = 8,
                verbose: bool = False) -> tuple[tuple[int, int, int, int], float]:
    """Local (x, y, w, h) search maximising mean best-NCC against the reference set.

    Objective uses the badge-trimmed crop (top 80% — the lock badge covers the
    bottom ~20%) without zoom on the coarse position pass, and a reduced zoom
    set (trimmed, full, 0.8-centred) on the size/fine passes.
    """

    def objective(rect: tuple[int, int, int, int], frame_idxs: Sequence[int], zoom: bool) -> float:
        total = 0.0
        for fi in frame_idxs:
            crop = corpus.crop(fi, rect)
            if crop.size == 0:
                return -1.0
            trim_h = max(1, math.floor(crop.shape[0] * BADGE_TRIM_RATIO))
            candidates = [crop[:trim_h, :]]
            if zoom:
                candidates.append(crop)
                sh, sw = crop.shape
                cw = max(8, math.floor(sw * 0.8 + 0.5))
                ch = max(8, math.floor(sh * 0.8 + 0.5))
                candidates.append(crop[(sh - ch) // 2:(sh - ch) // 2 + ch, (sw - cw) // 2:(sw - cw) // 2 + cw])
            total += max(matcher.fast_best_score(c) for c in candidates)
        return total / len(frame_idxs)

    x, y, w, h = seed
    rep = frames[-1]
    sample = list(frames[-3:]) if len(frames) > 3 else list(frames)

    def pos_pass(cx: int, cy: int, cw: int, ch: int, rng: int, step: int) -> tuple[int, int]:
        best_xy, best_score = (cx, cy), -1.0
        for dy in range(-rng, rng + 1, step):
            for dx in range(-rng, rng + 1, step):
                rect = (cx + dx, cy + dy, cw, ch)
                score = objective(rect, [rep], zoom=False)
                if score > best_score:
                    best_score, best_xy = score, (cx + dx, cy + dy)
        return best_xy

    def size_pass(cx: int, cy: int, cw: int, ch: int, rng: int, step: int) -> tuple[int, int]:
        best_wh, best_score = (cw, ch), -1.0
        for dh in range(-rng, rng + 1, step):
            for dw in range(-rng, rng + 1, step):
                score = objective((cx, cy, cw + dw, ch + dh), sample, zoom=True)
                if score > best_score:
                    best_score, best_wh = score, (cw + dw, ch + dh)
        return best_wh

    # Track the best rect under ONE consistent objective (zoom, mean over sample
    # frames) so a pass with a weaker proxy objective can never ship a worse box.
    best_rect, best_obj = (x, y, w, h), objective((x, y, w, h), sample, zoom=True)
    start_obj = best_obj
    x, y = pos_pass(x, y, w, h, pos_range, 2)
    x, y = pos_pass(x, y, w, h, min(2, pos_range), 1)
    w, h = size_pass(x, y, w, h, size_range, 2)
    w, h = size_pass(x, y, w, h, min(2, size_range), 1)
    x, y = pos_pass(x, y, w, h, min(1, pos_range), 1)
    final_obj = objective((x, y, w, h), sample, zoom=True)
    if final_obj > best_obj:
        best_rect, best_obj = (x, y, w, h), final_obj
    after = best_obj
    if verbose:
        print(f"    refine {seed} -> {best_rect} objective {start_obj:.3f} -> {after:.3f}")
    return best_rect, after


def first_filled_frame(corpus: Corpus, rect: tuple[int, int, int, int],
                       frames: Sequence[int]) -> int | None:
    """First frame whose crop std exceeds the runtime BLANK threshold."""
    for fi in frames:
        if corpus.crop_std(fi, rect) > BLANK_STD_THRESHOLD:
            return fi
    return None


def verify_slot(corpus: Corpus, matcher: Matcher, rect: tuple[int, int, int, int],
                frames: Sequence[int]) -> dict:
    """Per-frame classification across the draft window + temporal stability."""
    per_frame = []
    for fi in frames:
        crop = corpus.crop(fi, rect)
        if crop_std(crop) <= BLANK_STD_THRESHOLD:
            per_frame.append({"frame": fi, "classification": "empty", "hero_id": None, "score": 0.0})
            continue
        m = matcher.match(crop)
        per_frame.append({
            "frame": fi,
            "classification": "filled" if not m["abstained"] else "unidentified",
            "hero_id": m["hero_id"],
            "score": round(m["score"], 4),
            "best_candidate": m["best_candidate"],
        })
    filled = [p for p in per_frame if p["classification"] == "filled"]
    counts: dict[int, int] = {}
    for p in filled:
        counts[p["hero_id"]] = counts.get(p["hero_id"], 0) + 1
    modal = max(counts.items(), key=lambda t: t[1]) if counts else (None, 0)
    scores = [p["score"] for p in filled]
    return {
        "per_frame": per_frame,
        "filled_frames": len(filled),
        "modal_hero_id": modal[0],
        "modal_count": modal[1],
        "stability": (modal[1] / len(filled)) if filled else None,
        "mean_score": (sum(scores) / len(scores)) if scores else None,
        "min_score": min(scores) if scores else None,
        "max_score": max(scores) if scores else None,
        "first_filled": filled[0]["frame"] if filled else None,
        "hero_counts": counts,
    }


def detect_ban_circles(corpus: Corpus, strip: tuple[int, int, int, int],
                       frame_index: int, expected: int = 3) -> list[tuple[int, int, int, int]]:
    """Geometric detection of the circular ban icons inside one top strip.

    Projects chromatic pixels (chroma >= 48) onto the strip's x axis, takes the
    `expected` widest contiguous column runs (the circles), then bounds each
    run's rows. Returns rects ordered left-to-right.
    """
    x, y, w, h = strip
    rgb_frame = Image.open(corpus.dir / corpus.manifest[frame_index]).convert("RGB")
    px = np.asarray(rgb_frame).astype(np.int16)
    region = px[y:y + h, x:x + w]
    chroma = region.max(axis=2) - region.min(axis=2)
    mask = chroma >= 48
    col_counts = mask.sum(axis=0)
    runs: list[tuple[int, int]] = []
    start = None
    for cx in range(w):
        if col_counts[cx] >= 3:
            if start is None:
                start = cx
        elif start is not None:
            runs.append((start, cx - 1))
            start = None
    if start is not None:
        runs.append((start, w - 1))
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    rects = []
    for rx0, rx1 in sorted(runs[:expected]):
        sub = mask[:, rx0:rx1 + 1]
        rows = np.where(sub.sum(axis=1) >= 3)[0]
        if len(rows) == 0:
            continue
        ry0, ry1 = int(rows[0]), int(rows[-1])
        rects.append((x + rx0, y + ry0, rx1 - rx0 + 1, ry1 - ry0 + 1))
    while len(rects) < expected:
        rects.append((0, 0, 0, 0))
    return rects[:expected]


def badge_strict_counts(rgb: np.ndarray, rect: tuple[int, int, int, int]) -> tuple[int, int]:
    """Strict, intensity-gated warm/cool counts for the LOCK BADGE probe.

    The solid bright badge contributes 400..2000 pixels at (r > b+60, r >= 150)
    red / (b > r+60, b >= 150) blue; the dim ambient team glow stays below that.
    Kept separate from the hue-based region_warm_cool() used for the column tint.
    """
    x, y, w, h = rect
    sh, sw = rgb.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(sw, x + w), min(sh, y + h)
    if x1 <= x0 or y1 <= y0:
        return (0, 0)
    px = rgb[y0:y1, x0:x1].reshape(-1, 3)
    r, b = px[:, 0], px[:, 2]
    warm = int(np.count_nonzero((r > b + 60) & (r >= 150)))
    cool = int(np.count_nonzero((b > r + 60) & (b >= 150)))
    return (warm, cool)


def badge_lock_frames(corpus: Corpus, frames: Sequence[int]) -> tuple[dict[int, int | None], dict[int, int | None]]:
    """First frame per pick row where the team-coloured lock badge appears.

    Threshold 150 strict badge pixels (a real badge contributes 400..2000; the
    dim ambient glow stays below). The scan is restricted to the pick phase:
    pick locks cannot happen before the ban window ends, and the ban->pick
    transition frames bleed 150+ glow pixels into the badge rects.
    """
    red_locks: dict[int, int | None] = {}
    blue_locks: dict[int, int | None] = {}
    for row in range(5):
        red_locks[row] = None
        blue_locks[row] = None
        for fi in frames:
            if fi < PICK_WINDOW[0]:
                continue
            badges = corpus.badge_stats(fi)
            if red_locks[row] is None and badges["red"][row][0] >= 150:
                red_locks[row] = fi
            if blue_locks[row] is None and badges["blue"][row][1] >= 150:
                blue_locks[row] = fi
            if red_locks[row] is not None and blue_locks[row] is not None:
                break
    return red_locks, blue_locks


# =============================================================================
# Main
# =============================================================================

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kalibrasi RegionProfile draft ranked HoK Global 2800x1260.")
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--version", default="hok-ranked-2800x1260-v1")
    parser.add_argument("--min-score", type=float, default=0.55)
    parser.add_argument("--min-margin", type=float, default=0.04)
    parser.add_argument("--frames", default=None, help='Rentang frame verifikasi, mis. "28-78"')
    parser.add_argument("--ground-truth", type=Path, default=DEFAULT_GROUND_TRUTH)
    parser.add_argument("--no-refilter-references", action="store_true",
                        help="Lewati penulisan ulang PNG referensi dengan filter 0.")
    parser.add_argument("--no-self-check", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def expected_order_note() -> str:
    return ("right-1 -> left-1+left-2 -> right-2+right-3 -> left-3+left-4 -> right-4+right-5 -> left-5 "
            "(= RANKED_DRAFT_SEQUENCE B1, R1+R2, B2+B3, R3+R4, B4+B5, R5)")


def main() -> int:
    args = parse_args()
    verbose = args.verbose

    if not args.no_refilter_references:
        n = refilter_references(args.reference, verbose)
        print(f"Referensi difilter-0 ulang: {n} PNG (menetral bug Paeth di png-decode.mjs untuk decode Node)")

    if not args.no_self_check:
        if not run_self_check(args.reference, verbose):
            print("Melanjutkan tanpa memblokir, tetapi angka kalibrasi TIDAK terjamin identik dengan TS.", file=sys.stderr)

    refs = build_references(args.reference)
    if not refs:
        print(f"GALAT: tidak ada referensi di {args.reference}", file=sys.stderr)
        return 1
    matcher = Matcher(refs, args.min_score, args.min_margin)
    print(f"Referensi hero dimuat: {len(refs)}")

    if args.frames:
        text = args.frames.strip()
        if "-" in text:
            lo, hi = text.split("-", 1)
            frame_range = range(int(lo), int(hi) + 1)
        else:
            idxs = [int(t) for t in text.split(",")]
            frame_range = range(min(idxs), max(idxs) + 1)
    else:
        frame_range = range(BAN_WINDOW[0], PICK_WINDOW[1] + 1)
    corpus = Corpus(args.corpus, frame_range)
    if not corpus.indexes:
        print(f"GALAT: tidak ada frame {frame_range.start}..{frame_range.stop - 1} di {args.corpus}", file=sys.stderr)
        return 1
    print(f"Frame korpus dimuat: {len(corpus.indexes)} ({corpus.indexes[0]}..{corpus.indexes[-1]})")

    all_frames = corpus.indexes
    ban_frames = [i for i in all_frames if BAN_WINDOW[0] <= i <= BAN_WINDOW[1]]
    pick_frames = [i for i in all_frames if PICK_WINDOW[0] <= i <= PICK_WINDOW[1]]

    slot_defs: list[dict] = []
    for row, seed in enumerate(PICK_SEEDS_RED):
        slot_defs.append({"index": row, "side": "red", "kind": "pick", "seed": seed})
    for row, seed in enumerate(PICK_SEEDS_BLUE):
        slot_defs.append({"index": 5 + row, "side": "blue", "kind": "pick", "seed": seed})
    for col, seed in enumerate(BAN_SEEDS_RED):
        slot_defs.append({"index": 10 + col, "side": "red", "kind": "ban", "seed": seed})
    for col, seed in enumerate(BAN_SEEDS_BLUE):
        slot_defs.append({"index": 13 + col, "side": "blue", "kind": "ban", "seed": seed})

    results: list[dict] = []
    ban_geometry_report: list[dict] = []
    for slot in slot_defs:
        is_pick = slot["kind"] == "pick"
        if is_pick:
            refine_candidates = pick_frames
            pos_range, size_range = 10, 8
        else:
            # Bans: the two independent frame analyses agree on the measured
            # circle geometry within ~10 px, and the padlock overlay makes NCC
            # refinement unreliable, so the measured seed ships as-is.
            # Geometric blob detection is run only as an independent cross-check.
            strip = LEFT_BAN_STRIP if slot["side"] == "red" else RIGHT_BAN_STRIP
            col = slot["index"] - 10 if slot["side"] == "red" else slot["index"] - 13
            geometry_frames = (ban_frames + pick_frames)[::7][:6] or all_frames[-1:]
            per_frame_boxes = [detect_ban_circles(corpus, strip, i) for i in geometry_frames]
            med = []
            for axis in range(4):
                vals = sorted(b[col][axis] for b in per_frame_boxes if b[col][axis] > 0)
                med.append(int(np.median(vals)) if vals else 0)
            slot["seed"] = (BAN_SEEDS_RED + BAN_SEEDS_BLUE)[slot["index"] - 10]
            delta = [med[i] - slot["seed"][i] for i in range(4)]
            ban_geometry_report.append({"index": slot["index"], "detectedBlob": med,
                                        "usedSeed": list(slot["seed"]), "blobMinusSeedDelta": delta})
            refine_candidates = ban_frames + pick_frames
            pos_range, size_range = 0, 0
        refine_frames = [i for i in refine_candidates if corpus.crop_std(i, slot["seed"]) > BLANK_STD_THRESHOLD]
        if not refine_frames:
            print(f"  slot {slot['index']} ({slot['side']} {slot['kind']}): tidak pernah terisi di rentang uji "
                  f"— seed dipakai apa adanya, TERVERIFIKASI: TIDAK", file=sys.stderr)
            slot.update({"rect": slot["seed"], "verified": False})
            results.append(slot)
            continue
        rect, obj = refine_rect(corpus, matcher, slot["seed"], refine_frames,
                                pos_range=pos_range, size_range=size_range, verbose=verbose)
        occ = first_filled_frame(corpus, rect, all_frames)
        ver = verify_slot(corpus, matcher, rect, all_frames)
        stable = ver["stability"] is not None and ver["stability"] >= 0.95
        scored = ver["mean_score"] is not None and ver["mean_score"] >= args.min_score
        # Pick slots: stability + score. Bans: occupancy stability only — the
        # padlock overlay covers ~40% of a 64px circle, so identity here is
        # explicitly UNVERIFIED (geometry verified).
        verified = bool(stable and scored) if is_pick else bool(stable)
        slot.update({
            "rect": rect,
            "objective": round(obj, 4),
            "first_filled_frame": occ,
            "verified": verified,
            "identityVerified": bool(is_pick and verified),
            "verification": ver,
        })
        flag = "OK" if verified else "TIDAK"
        stab = ver["stability"]
        mean = ver["mean_score"]
        print(f"  slot {slot['index']:2d} ({slot['side']:4s} {slot['kind']}): rect={rect} "
              f"firstFilled={occ} filled={ver['filled_frames']} modal={ver['modal_hero_id']} "
              f"stability={stab if stab is None else round(stab, 3)} "
              f"meanScore={mean if mean is None else round(mean, 3)} verified={flag}"
              + ("" if is_pick else " [geometri OK; identitas TIDAK diverifikasi - padlock]"))
        results.append(slot)

    # ---- badge lock times ---------------------------------------------------
    red_locks, blue_locks = badge_lock_frames(corpus, all_frames)
    chevron_by_slot: dict[int, int | None] = {}
    for row, frame in red_locks.items():
        chevron_by_slot[row] = frame
    for row, frame in blue_locks.items():
        chevron_by_slot[5 + row] = frame

    # ---- frame-78 identity check against ground truth ----------------------
    frame78: dict = {"frame": 78, "slots": [], "accuracy": None, "accuracyNote": None}
    if args.ground_truth.exists():
        gt = json.loads(args.ground_truth.read_text("utf8"))
        gt_by_index = {s["slotIndexInProfile"]: s for s in gt["slots"]}
        solid = weak = unresolved = matched = 0
        for slot in results:
            if slot["kind"] != "pick":
                continue
            m78 = matcher.match(corpus.crop(78, slot["rect"]))
            truth = gt_by_index.get(slot["index"], {})
            gt_id = truth.get("hero_id")
            gt_status = truth.get("idStatus", "solid")
            ok = m78["hero_id"] is not None and m78["hero_id"] == gt_id
            matched += 1 if ok else 0
            if m78["abstained"] or m78["hero_id"] is None:
                status = "UNRESOLVED (abstain)"
                unresolved += 1
            elif ok and m78["score"] >= 0.65 and gt_status == "solid":
                status = "SOLID"
                solid += 1
            elif ok:
                status = f"WEAK (score {m78['score']:.2f}; GT {gt_status})"
                weak += 1
            else:
                status = f"MISMATCH vs GT ({gt_id})"
                unresolved += 1
            frame78["slots"].append({
                "index": slot["index"], "side": slot["side"],
                "recognised": m78["hero_id"], "score": round(m78["score"], 4),
                "abstained": m78["abstained"], "bestCandidate": m78["best_candidate"],
                "top3": [(hid, round(s, 4)) for hid, s in m78["candidates"]],
                "groundTruth": gt_id, "groundTruthName": truth.get("hero_name"),
                "groundTruthStatus": gt_status, "match": ok, "status": status,
            })
            print(f"    slot {slot['index']:2d} ({slot['side']:4s}): recognised={m78['hero_id']} "
                  f"score={m78['score']:.3f} abstained={m78['abstained']} vs GT {gt_id} "
                  f"{truth.get('hero_name')} ({gt_status}) -> {status}")
        frame78["accuracy"] = f"{matched}/{len(frame78['slots'])} vs GT"
        frame78["accuracyNote"] = (f"solid={solid}, weak={weak}, unresolved/mismatch={unresolved}. "
                                   "GT L1/L4/L5 berstatus uncertain (kemungkinan skin): kecocokan di sana "
                                   "bisa false-positive skin-vs-base.")
        print(f"Frame-78 identitas vs ground truth: {frame78['accuracy']} ({frame78['accuracyNote']})")
    else:
        print(f"Peringatan: ground truth tidak ditemukan di {args.ground_truth}; identitas frame-78 dilewati.")

    ids78 = [s["recognised"] for s in frame78["slots"] if s["recognised"] is not None]
    frame78["distinct"] = len(set(ids78)) == len(ids78) == 10
    if ids78 and len(set(ids78)) != len(ids78):
        print(f"PERINGATAN: hero duplikat pada frame 78: {ids78}", file=sys.stderr)
    neg = matcher.match(corpus.crop(78, CENTRE_MODEL_RECT))
    print(f"Kontrol negatif (model 3D tengah): best score {neg['score']:.3f} "
          f"abstained={neg['abstained']} hero={neg['hero_id']} (harusnya abstain/skor rendah)")

    # ---- colour-side verification ------------------------------------------
    # The operator's cue is the tint BEFORE picks happen, so the ban-phase
    # frames (empty tinted placeholders, no portrait art) are the clean sample;
    # the pick-phase tile numbers are reported too (portrait art mixes in).
    # Sample the PICK-SLOT TILE interiors — the column bands mix in the
    # dark-navy scene background, which reads cool and drowns the tile tint.
    def tile_averages(frames: Sequence[int]) -> dict:
        acc = {"left": [0, 0, 0], "right": [0, 0, 0]}
        for fi in frames:
            for side, seeds in (("left", PICK_SEEDS_RED), ("right", PICK_SEEDS_BLUE)):
                rgb = np.asarray(Image.open(corpus.dir / corpus.manifest[fi]).convert("RGB"))
                for rect in seeds:
                    for k in range(3):
                        acc[side][k] += region_warm_cool(rgb, rect, return_sat=True)[k]
                del rgb
        n = len(frames) or 1
        return {side: {k: round(acc[side][i] / n, 1) for i, k in enumerate(("warm", "cool", "saturated"))}
                for side in ("left", "right")}

    colour_ban = tile_averages(ban_frames)
    colour_pick = tile_averages(pick_frames)
    left_red = (colour_ban["left"]["warm"] > colour_ban["left"]["cool"] * 1.5
                and colour_ban["left"]["saturated"] > 100)
    right_blue = (colour_ban["right"]["cool"] > colour_ban["right"]["warm"] * 1.5
                  and colour_ban["right"]["saturated"] > 100)
    print(f"Verifikasi warna kolom (FASE BAN, {len(ban_frames)} frame, placeholder polos): "
          f"left warm={colour_ban['left']['warm']} cool={colour_ban['left']['cool']} "
          f"sat={colour_ban['left']['saturated']} -> {'MERAH (ownSide=red cocok)' if left_red else 'TIDAK MERAH!'}")
    print(f"                        right warm={colour_ban['right']['warm']} cool={colour_ban['right']['cool']} "
          f"sat={colour_ban['right']['saturated']} -> {'BIRU (cocok)' if right_blue else 'TIDAK BIRU!'}")
    print(f"  (fase pick, campur potret: left warm={colour_pick['left']['warm']} "
          f"cool={colour_pick['left']['cool']}; right warm={colour_pick['right']['warm']} "
          f"cool={colour_pick['right']['cool']})")

    # ---- placeholder diagnostics (runtime blank rule during the ban phase) --
    placeholder_diag = []
    diag_frame = ban_frames[len(ban_frames) // 2] if ban_frames else all_frames[0]
    for s in [r for r in results if r["kind"] == "pick"]:
        crop = corpus.crop(diag_frame, s["rect"])
        std = round(crop_std(crop), 2)
        m = matcher.match(crop)
        placeholder_diag.append({"index": s["index"], "side": s["side"], "frame": diag_frame,
                                 "std": std, "blankPerRuntimeRule": std <= BLANK_STD_THRESHOLD,
                                 "matcherAbstained": m["abstained"], "matcherHeroId": m["hero_id"],
                                 "matcherScore": round(m["score"], 4)})
        print(f"  placeholder slot {s['index']:2d} frame {diag_frame}: std={std} "
              f"blank(std<={BLANK_STD_THRESHOLD})={std <= BLANK_STD_THRESHOLD} "
              f"matcherAbstained={m['abstained']} heroId={m['hero_id']} score={m['score']:.3f}")

    # ---- anchors ------------------------------------------------------------
    anchor_rects = {
        "banner_text": BANNER_TEXT_RECT,
        "skill_button": SKILL_BUTTON_RECT,
        "left_team_column": RED_COLUMN_BAND,
        "right_team_column": BLUE_COLUMN_BAND,
        "left_ban_strip": LEFT_BAN_STRIP,
        "right_ban_strip": RIGHT_BAN_STRIP,
        "bottom_button_row": BOTTOM_BUTTON_ROW_RECT,
    }
    anchors = [{"label": label, "rect": {"x": r[0], "y": r[1], "w": r[2], "h": r[3]}}
               for label, r in anchor_rects.items()]
    lobby_frames = [i for i in corpus.indexes if LOBBY_WINDOW[0] <= i <= LOBBY_WINDOW[1]]
    anchor_report = []
    for label, r in anchor_rects.items():
        draft_stds = [corpus.crop_std(i, r) for i in all_frames]
        present = sum(1 for s in draft_stds if s > 8.0) / len(draft_stds) if draft_stds else 0.0
        anchor_report.append({
            "label": label,
            "draftPresentRatio": round(present, 3),
            "draftMeanStd": round(sum(draft_stds) / len(draft_stds), 2) if draft_stds else None,
        })
        print(f"  anchor {label}: draft present={present:.2f} meanStd={sum(draft_stds) / len(draft_stds):.1f}")

    # ---- emit profile -------------------------------------------------------
    profile = {
        "version": args.version,
        "resolution": {"width": 2800, "height": 1260},
        "ownSide": "red",
        "slots": [
            {"index": s["index"], "side": s["side"], "kind": s["kind"],
             "rect": {"x": s["rect"][0], "y": s["rect"][1], "w": s["rect"][2], "h": s["rect"][3]}}
            for s in results
        ],
        "anchors": anchors,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(profile, indent=2) + "\n", "utf8")
    print(f"Profil ditulis: {args.out}")

    picks = [s for s in results if s["kind"] == "pick"]
    def order_key(s: dict) -> tuple[int, int]:
        chev = chevron_by_slot.get(s["index"])
        return (chev if chev is not None else 10**6, s.get("first_filled_frame") or 10**6)
    by_lock = sorted([p for p in picks if (p.get("first_filled_frame") is not None)], key=order_key)
    derived = [(p["index"], p["side"], chevron_by_slot.get(p["index"]), p.get("first_filled_frame")) for p in by_lock]
    derived_idx = [i for i, _, _, _ in derived]
    # Expected turn grouping: right1 | left1+left2 | right2+right3 | left3+left4 | right4+right5 | left5.
    # Within a turn the two picks are near-simultaneous; capture granularity
    # (~3 s/frame) can swap them, so the check is group-level.
    expected_groups = [(5,), (0, 1), (6, 7), (2, 3), (8, 9), (4,)]
    expected_seq = [i for g in expected_groups for i in g]
    slot_by_index = {p["index"]: p for p in picks}
    group_normalized: list[int] = []
    for group in expected_groups:
        group_normalized.extend(sorted((i for i in derived_idx if i in group), key=lambda i: order_key(slot_by_index[i])))
    order_matches = derived_idx == expected_seq
    group_matches = group_normalized == expected_seq
    print("Urutan kronologis pick (sinyal utama: badge LOCK; fallback: firstFilled):")
    for idx, side, lock, occ in derived:
        print(f"  lock frame {str(lock):>4}  firstFilled {str(occ):>4}  slot {idx:2d} ({side} baris {idx % 5 + 1})")
    print(f"  urutan slot (lock): {derived_idx}")
    print(f"  expected (grup)   : {expected_seq}  -> raw {'COCOK' if order_matches else 'BERBEDA'}; "
          f"group-level {'COCOK' if group_matches else 'BERBEDA'}")
    print(f"  expected pattern: {expected_order_note()}")

    fillorder = {
        "profile": args.version,
        "resolution": {"width": 2800, "height": 1260},
        "note": "firstFilledFrame = frame pertama dengan std crop > 4.0 (aturan blank runtime pipeline.ts). "
                "firstChevronFrame = frame pertama badge kunci berwarna tim muncul di bawah slot (sinyal LOCK; "
                "potret tanpa badge bisa berupa pre-selection yang masih berubah).",
        "slots": [
            {"index": s["index"], "side": s["side"], "kind": s["kind"],
             "rect": {"x": s["rect"][0], "y": s["rect"][1], "w": s["rect"][2], "h": s["rect"][3]},
             "verified": s.get("verified", False),
             "firstFilledFrame": s.get("first_filled_frame"),
             "firstChevronFrame": chevron_by_slot.get(s["index"]),
             "stability": s["verification"]["stability"] if "verification" in s else None,
             "meanScore": s["verification"]["mean_score"] if "verification" in s else None,
             "maxScore": s["verification"]["max_score"] if "verification" in s else None,
             "modalHeroId": s["verification"]["modal_hero_id"] if "verification" in s else None,
             "heroCounts": {str(k): v for k, v in s["verification"]["hero_counts"].items()} if "verification" in s else {}}
            for s in results
        ],
        "colourSide": {
            "banPhase": colour_ban, "pickPhase": colour_pick,
            "leftReadsRed": left_red, "rightReadsBlue": right_blue,
            "ownSide": "red",
            "note": "warna disampel pada fase ban (placeholder polos tanpa potret); "
                    "fase pick tercemar warna potret hero itu sendiri",
        },
        "placeholderDiagnostics": placeholder_diag,
        "banGeometry": ban_geometry_report,
        "frame78Identity": frame78,
        "anchors": anchor_report,
        "derivedPickOrder": {"byLockSignal": derived_idx, "groupNormalized": group_normalized,
                             "expected": expected_seq,
                             "matchesExpectedSequenceRaw": order_matches,
                             "matchesExpectedSequenceGroupLevel": group_matches,
                             "expectedPattern": expected_order_note()},
    }
    fill_path = args.out.with_name(args.out.name + ".fillorder.json")
    fill_path.write_text(json.dumps(fillorder, indent=2) + "\n", "utf8")
    print(f"Laporan fill-order ditulis: {fill_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
