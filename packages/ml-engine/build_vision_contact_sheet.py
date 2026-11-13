"""Build labelled contact sheets (thumbnail grids) from a vision-corpus directory.

Reads the `NNN_<label>.png` frames written by capture_vision_corpus.py, renders
each frame as a thumbnail cell with an index+label caption strip, and lays the
cells out left-to-right / top-to-bottom into one or more `contact_sheet_NNN.png`
grids plus a machine-readable `contact_sheet_index.json` that maps every cell
box (exact sheet-pixel rect) back to its source file — the mechanism used to
auto-label a ground-truth corpus of game screenshots.

Safety with a concurrently-growing corpus: the file list is read ONCE at the
start, any frame that disappears or fails to decode mid-run is skipped with a
warning, and nothing inside the corpus directory is ever modified. The only
writes go to the output directory. Stdlib + Pillow only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / "data" / "vision-corpus"

NAME_RE = re.compile(r"^(\d+)_(.+)\.png$", re.IGNORECASE)
NEGATIVE_INDEX_FLOOR = 900  # indices >= 900 are curated negative samples, not sequential frames
HEADER_HEIGHT = 40
BG_COLOR = (16, 16, 20)
CELL_BG_COLOR = (28, 28, 36)
STRIP_COLOR = (10, 10, 14)
TEXT_COLOR = (235, 235, 245)
BAR_ON = (255, 200, 40)
BAR_OFF = (60, 60, 70)


def parse_args(argv=None):
    """Parse CLI arguments for the contact-sheet builder."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help=f"folder corpus (default: {DEFAULT_DIR})")
    parser.add_argument("--out", type=Path, default=None, help="folder output sheet (default: <dir>/sheets)")
    parser.add_argument("--cols", type=int, default=8, help="jumlah kolom grid (default: 8)")
    parser.add_argument("--thumb-width", type=int, default=420, help="lebar thumbnail px (default: 420)")
    parser.add_argument("--max-cells", type=int, default=96, help="maks sel per sheet; sisanya spill ke sheet berikutnya (default: 96)")
    parser.add_argument("--start", type=int, default=None, help="index frame awal (inklusif)")
    parser.add_argument("--end", type=int, default=None, help="index frame akhir (inklusif)")
    parser.add_argument("--include", action="append", default=[], metavar="NAME", help="file yang dipaksa masuk (boleh diulang; menimpa aturan exclude)")
    parser.add_argument("--label-height", type=int, default=26, help="tinggi strip caption px (default: 26)")
    args = parser.parse_args(argv)
    if args.cols <= 0:
        parser.error("--cols harus > 0")
    if args.thumb_width <= 0:
        parser.error("--thumb-width harus > 0")
    if args.max_cells <= 0:
        parser.error("--max-cells harus > 0")
    if args.label_height < 8:
        parser.error("--label-height minimal 8")
    if args.start is not None and args.end is not None and args.start > args.end:
        parser.error("--start tidak boleh lebih besar dari --end")
    if args.out is None:
        args.out = args.dir / "sheets"
    return args


def collect_frames(corpus_dir, include_names, start, end):
    """List candidate frames ONCE from corpus_dir; returns (frames, excluded).

    Each frame is a dict {file, index, label}. Default rules: skip names
    starting with `_` (temporary probe files) and skip indices >= 900
    (curated negative samples). `--include` overrides both rules per file.
    """
    include_set = {name for name in include_names if name}
    unknown_includes = set(include_set)
    frames = []
    excluded = []  # (file, reason)
    entries = sorted(corpus_dir.iterdir(), key=lambda p: p.name)  # single pass, snapshot
    for path in entries:
        if not path.is_file():
            continue
        match = NAME_RE.match(path.name)
        if match is None:
            if path.suffix.lower() == ".png":
                excluded.append((path.name, "nama tidak cocok pola NNN_<label>.png (file sementara/probe)"))
            continue
        index = int(match.group(1))
        label = match.group(2)
        if path.name in include_set:
            frames.append({"file": path.name, "index": index, "label": label})
            unknown_includes.discard(path.name)
            continue
        if path.name.startswith("_"):
            excluded.append((path.name, "nama diawali '_' (file probe sementara)"))
            continue
        if index >= NEGATIVE_INDEX_FLOOR:
            excluded.append((path.name, f"index >= {NEGATIVE_INDEX_FLOOR} (negative sample terkurasi)"))
            continue
        if start is not None and index < start:
            excluded.append((path.name, f"index < --start {start}"))
            continue
        if end is not None and index > end:
            excluded.append((path.name, f"index > --end {end}"))
            continue
        frames.append({"file": path.name, "index": index, "label": label})
    frames.sort(key=lambda f: (f["index"], f["file"]))
    for name in sorted(unknown_includes):
        excluded.append((name, "--include: file tidak ditemukan di corpus"))
    return frames, excluded


def load_manifest(corpus_dir):
    """Read manifest.jsonl into {file: record}; malformed lines are skipped with a warning."""
    manifest_path = corpus_dir / "manifest.jsonl"
    records = {}
    try:
        with manifest_path.open(encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    print(f"WARNING: manifest.jsonl baris {line_no} tidak valid, dilewati ({exc}).", file=sys.stderr)
                    continue
                if isinstance(record, dict) and isinstance(record.get("file"), str):
                    records[record["file"]] = record
                else:
                    print(f"WARNING: manifest.jsonl baris {line_no} tanpa field 'file', dilewati.", file=sys.stderr)
    except FileNotFoundError:
        print("WARNING: manifest.jsonl tidak ada; index/label diambil dari nama file, ts = null.", file=sys.stderr)
    return records


def probe_thumbnails(frames, corpus_dir, cell_width):
    """Pass 1: open every frame header-only for its aspect ratio; drop unreadable frames.

    Returns (kept_frames, thumb_heights) where thumb_heights maps file -> the
    natural thumbnail height at cell_width; unusable frames are removed.
    """
    kept = []
    heights = {}
    for frame in frames:
        path = corpus_dir / frame["file"]
        try:
            with Image.open(path) as image:
                width, height = image.size
        except (OSError, ValueError) as exc:
            print(f"WARNING: {frame['file']} tidak terbaca, dilewati ({exc}).", file=sys.stderr)
            continue
        if width <= 0 or height <= 0:
            print(f"WARNING: {frame['file']} berdimensi 0, dilewati.", file=sys.stderr)
            continue
        kept.append(frame)
        heights[frame["file"]] = max(1, round(height * cell_width / width))
    return kept, heights


def pick_cell_height(heights):
    """Pick one common cell height: the most frequent natural thumb height (grid stays uniform)."""
    counts = Counter(heights.values())
    best_count, best_height = 0, None
    for height in sorted(counts):  # deterministic tie-break: smallest height wins
        if counts[height] > best_count:
            best_count, best_height = counts[height], height
    return best_height if best_height is not None else 1


def render_caption(strip, index, label, label_height):
    """Draw `NNN label` on the dark caption strip; fall back to a colour-block bar if text fails."""
    draw = ImageDraw.Draw(strip)
    text = f"{index:03d} {label}" if label else f"{index:03d}"
    try:
        font = ImageFont.load_default()
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        text_w, text_h = right - left, bottom - top
        if text_w <= 0 or text_h <= 0 or text_h > label_height:
            raise ValueError(f"teks {text_w}x{text_h} tidak muat di strip {label_height}px")
        draw.text(((strip.width - text_w) // 2 - left, (label_height - text_h) // 2 - top), text, font=font, fill=TEXT_COLOR)
        return
    except Exception:
        pass
    # Fallback: encode the index as a high-contrast binary colour-block pattern.
    bits = max(1, index.bit_length())
    block_w = max(2, min(8, (strip.width - 8) // max(bits, 1)))
    block_h = max(4, label_height // 3)
    x = (strip.width - bits * block_w) // 2
    y = (label_height - block_h) // 2
    for bit in range(bits):
        color = BAR_ON if index & (1 << (bits - 1 - bit)) else BAR_OFF
        draw.rectangle((x, y, x + block_w - 1, y + block_h - 1), fill=color)
        x += block_w


def render_sheet(sheet_index, chunk, corpus_dir, manifest, cell_width, cell_height, label_height, cols, source_dir):
    """Render one contact sheet PNG; returns (image, cells) with exact cell boxes."""
    rows = (len(chunk) + cols - 1) // cols
    sheet_w = cols * cell_width
    sheet_h = HEADER_HEIGHT + rows * (cell_height + label_height)
    sheet = Image.new("RGB", (sheet_w, sheet_h), BG_COLOR)
    draw = ImageDraw.Draw(sheet)
    first_index, last_index = chunk[0]["index"], chunk[-1]["index"]
    header = f"Sheet {sheet_index:03d} | frames {first_index:03d}-{last_index:03d} ({len(chunk)} cells) | {source_dir}"
    try:
        font = ImageFont.load_default()
        draw.text((6, (HEADER_HEIGHT - (font.getbbox(header)[3] - font.getbbox(header)[1])) // 2), header, font=font, fill=TEXT_COLOR)
    except Exception:
        pass  # header is decorative; cells remain mappable via the JSON index
    cells = []
    for position, frame in enumerate(chunk):
        row, col = divmod(position, cols)
        box_x = col * cell_width
        box_y = HEADER_HEIGHT + row * (cell_height + label_height)
        path = corpus_dir / frame["file"]
        try:
            with Image.open(path) as image:
                frame_w, frame_h = image.size
                scale = min(cell_width / frame_w, cell_height / frame_h)
                thumb_w = max(1, round(frame_w * scale))
                thumb_h = max(1, round(frame_h * scale))
                thumb = image.convert("RGB").resize((thumb_w, thumb_h))
        except (OSError, ValueError) as exc:
            print(f"WARNING: {frame['file']} hilang/tidak terbaca saat render, dilewati ({exc}).", file=sys.stderr)
            continue
        sheet.paste(thumb, (box_x + (cell_width - thumb_w) // 2, box_y + (cell_height - thumb_h) // 2))
        strip = Image.new("RGB", (cell_width, label_height), STRIP_COLOR)
        render_caption(strip, frame["index"], frame["label"], label_height)
        sheet.paste(strip, (box_x, box_y + cell_height))
        record = manifest.get(frame["file"], {})
        cells.append({
            "index": frame["index"],
            "file": frame["file"],
            "label": frame["label"],
            "ts": record.get("ts"),
            "row": row,
            "col": col,
            "box": {"x": box_x, "y": box_y, "w": cell_width, "h": cell_height},
        })
    return sheet, cells


def run_build(args):
    """Build all contact sheets + index; returns the number of frames included."""
    corpus_dir = args.dir.resolve()
    out_dir = args.out.resolve()
    if not corpus_dir.is_dir():
        print(f"ERROR: folder corpus tidak ditemukan: {corpus_dir}", file=sys.stderr)
        raise SystemExit(1)
    out_dir.mkdir(parents=True, exist_ok=True)

    frames, excluded = collect_frames(corpus_dir, args.include, args.start, args.end)
    manifest = load_manifest(corpus_dir)
    frames, natural_heights = probe_thumbnails(frames, corpus_dir, args.thumb_width)
    if not frames:
        print("ERROR: tidak ada frame yang bisa diproses; tidak ada sheet ditulis.", file=sys.stderr)
        raise SystemExit(1)
    cell_height = pick_cell_height(natural_heights)

    sheets = []
    all_cells = []
    chunks = [frames[offset:offset + args.max_cells] for offset in range(0, len(frames), args.max_cells)]
    for sheet_index, chunk in enumerate(chunks, start=1):
        sheet, cells = render_sheet(
            sheet_index, chunk, corpus_dir, manifest,
            args.thumb_width, cell_height, args.label_height, args.cols, str(corpus_dir),
        )
        file_name = f"contact_sheet_{sheet_index:03d}.png"
        sheet.save(out_dir / file_name)
        sheets.append({"file": file_name, "sheetIndex": sheet_index, "headerHeight": HEADER_HEIGHT, "cells": cells})
        all_cells.extend(cells)
        print(f"  {file_name}: {sheet.width}x{sheet.height}, {len(cells)} sel", file=sys.stderr)

    index_doc = {
        "sourceDir": str(corpus_dir),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cellWidth": args.thumb_width,
        "cellHeight": cell_height,
        "labelHeight": args.label_height,
        "cols": args.cols,
        "sheets": sheets,
    }
    (out_dir / "contact_sheet_index.json").write_text(
        json.dumps(index_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    print(f"Selesai: {len(sheets)} sheet, {len(all_cells)} frame dimasukkan -> {out_dir}", file=sys.stderr)
    if excluded:
        print(f"Dikecualikan ({len(excluded)}):", file=sys.stderr)
        for name, reason in excluded:
            print(f"  {name}: {reason}", file=sys.stderr)
    return len(all_cells)


def main():
    """CLI entry point."""
    args = parse_args()
    run_build(args)


if __name__ == "__main__":
    main()
