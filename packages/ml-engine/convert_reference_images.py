"""Convert hero portrait assets (webp/jpg/jpeg/png) to RGBA PNG for Node tooling.

Node has no built-in webp decoder, while its PNG decoder (apps/web/scripts/
png-decode.mjs) only accepts RGB/RGBA. This script converts every portrait
asset `{hero_id}.webp|.jpg|.jpeg|.png` under apps/web/public/assets/heroes
into `{hero_id}.png` with the SAME pixel size, written to a target directory
that is NOT inside apps/web/public/ or data/ (default: a fresh folder under
the system temp dir). Non-webp portraits (e.g. the CN-exclusive `.jpg` files)
are converted too so the Node reference set covers every dataset hero.

Run from packages/ml-engine:  uv run convert_reference_images.py [--help]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

# Same convention as publish_data.py: repo root is two levels above this file.
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SRC = ROOT / "apps/web/public/assets/heroes"

# Every portrait asset format published under the heroes asset folder.
PORTRAIT_EXTENSIONS = (".webp", ".jpg", ".jpeg", ".png")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Konversi potret hero (webp/jpg/jpeg/png) menjadi PNG RGBA berukuran piksel sama agar bisa dibaca dekoder Node.",
    )
    parser.add_argument(
        "--src",
        type=Path,
        default=DEFAULT_SRC,
        help="Folder sumber berisi {hero_id}.webp/.jpg/.jpeg/.png (default: apps/web/public/assets/heroes di repo ini).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Folder tujuan PNG (default: folder baru di bawah folder temp sistem).",
    )
    return parser.parse_args()


def default_out_dir() -> Path:
    import tempfile

    return Path(tempfile.gettempdir()) / "hok-draft-engine-ref-png"


def collect_sources(src_dir: Path) -> list[Path]:
    """Collect one portrait path per hero id, keeping the first when several formats share an id."""
    chosen: dict[str, Path] = {}
    for path in sorted(src_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in PORTRAIT_EXTENSIONS:
            continue
        hero_id = path.stem
        if hero_id not in chosen:
            chosen[hero_id] = path
    return sorted(chosen.values(), key=lambda path: path.stem)


def convert(src_dir: Path, out_dir: Path) -> tuple[list[str], list[str]]:
    """Convert every portrait asset under src_dir; returns (converted ids, skipped ids)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    converted: list[str] = []
    skipped: list[str] = []
    for portrait_path in collect_sources(src_dir):
        hero_id = portrait_path.stem
        out_path = out_dir / f"{hero_id}.png"
        try:
            with Image.open(portrait_path) as image:
                image.convert("RGBA").save(out_path, format="PNG")
            converted.append(hero_id)
        except Exception as error:  # noqa: BLE001 - one bad asset must not abort the run
            skipped.append(hero_id)
            print(f"PERINGATAN: gagal mengonversi {portrait_path.name}: {error}", file=sys.stderr)
    return converted, skipped


def main() -> int:
    args = parse_args()
    src_dir: Path = args.src
    out_dir: Path = args.out if args.out is not None else default_out_dir()
    if not src_dir.is_dir():
        print(f"GALAT: folder sumber tidak ditemukan: {src_dir}", file=sys.stderr)
        return 1
    if not collect_sources(src_dir):
        print(f"GALAT: tidak ada berkas potret ({', '.join(PORTRAIT_EXTENSIONS)}) di {src_dir}", file=sys.stderr)
        return 1

    converted, skipped = convert(src_dir, out_dir)
    print(f"Berhasil dikonversi : {len(converted)} potret")
    if skipped:
        print(f"Dilewati (gagal)    : {len(skipped)} -> {', '.join(skipped)}")
    print(f"Folder tujuan       : {out_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
