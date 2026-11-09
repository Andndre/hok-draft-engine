"""Package only the source and mappings needed by the NanoJev proposal notebook."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "processed" / "nanojev_source_bundle.zip"
REQUIRED_FILES = (
    "packages/ml-engine/tactical_profiles.py",
    "packages/ml-engine/nanojev_provider.py",
    "packages/ml-engine/dataset_sources.py",
    "data/mappings/master_heroes_global.json",
    "data/mappings/hero_release_status.json",
    "data/mappings/hokstats_heroes.json",
    "data/mappings/hokstats_matchup_reviews.json",
    "data/mappings/hokstats_guide_reviews.json",
)


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def create_bundle(destination: Path) -> dict:
    files = {}
    contents = {}
    missing = []
    for relative in REQUIRED_FILES:
        path = ROOT / Path(relative)
        if not path.is_file():
            missing.append(relative)
            continue
        content = path.read_bytes()
        contents[relative] = content
        files[relative] = sha256(content)
    if missing:
        raise FileNotFoundError("Source bundle tidak lengkap: " + ", ".join(missing))

    bundle_digest = hashlib.sha256()
    for relative, digest in sorted(files.items()):
        bundle_digest.update(f"{relative}\0{digest}\n".encode("utf-8"))
    manifest = {
        "schema_version": 1,
        "bundle_id": bundle_digest.hexdigest(),
        "files": files,
    }

    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for relative in REQUIRED_FILES:
            archive.writestr(relative, contents[relative])
        archive.writestr(
            "notebook_bundle_manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Buat ZIP privat untuk menjalankan proposal NanoJev tanpa clone GitHub.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"Lokasi ZIP (default: {DEFAULT_OUTPUT})")
    args = parser.parse_args()
    manifest = create_bundle(args.output)
    print(f"Source bundle: {args.output.expanduser().resolve()}")
    print(f"Bundle ID: {manifest['bundle_id']}")
    print(f"File sumber: {len(manifest['files'])}")
    print("Checkpoint model tidak termasuk; notebook mengunduhnya secara terpisah dari rilis resmi.")


if __name__ == "__main__":
    main()
