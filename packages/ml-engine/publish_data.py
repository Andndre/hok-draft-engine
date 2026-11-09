"""Build a versioned production dataset. --publish uploads artifacts before the manifest."""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
from tactical_profiles import approved_profiles

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"
PUBLIC = ROOT / "apps/web/public"


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def build_package(heroes, synergy, releases, profiles=None):
    if releases.get("511") != {"released": False, "alias_of": 556}:
        raise ValueError("511 harus tetap menjadi alias tidak aktif untuk Ata 556.")
    seen = set()
    output = []
    for original in heroes:
        hero = dict(original)
        hero_id = hero["hero_id"]
        if hero_id == 511 or hero_id in seen:
            raise ValueError("ID hero duplikat atau alias aktif.")
        seen.add(hero_id)
        if not isinstance(releases.get(str(hero_id), {}).get("released"), bool):
            raise ValueError(f"Status rilis hero {hero_id} belum ditinjau.")
        hero["is_global_released"] = releases[str(hero_id)]["released"]
        hero.pop("tactical_profile", None)
        if profiles and hero_id in profiles:
            hero["tactical_profile"] = profiles[hero_id]
        output.append(hero)
    texts = {"heroes": encode(output), "synergy": encode(synergy), "releases": encode(releases)}
    hashes = {key: hashlib.sha256(value).hexdigest() for key, value in texts.items()}
    version = hashlib.sha256(encode(hashes)).hexdigest()[:16]
    names = {"heroes": "hero_metadata.json", "synergy": "kpl_synergy_matrix.json", "releases": "hero_release_status.json"}
    manifest = {"schema_version": 1, "dataset_version": version, "hero_count": len(output), "artifacts": {key: {"file": f"datasets/{version}/{names[key]}", "sha256": hashes[key]} for key in texts}}
    return manifest, texts


def write_package(destination, manifest, texts):
    destination.mkdir(parents=True, exist_ok=True)
    for key, contents in texts.items():
        target = destination / manifest["artifacts"][key]["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != contents:
            raise ValueError("Artefak immutable sudah ada dengan isi berbeda.")
        target.write_bytes(contents)
    temporary = destination / "data_manifest.json.tmp"
    temporary.write_bytes(encode(manifest))
    temporary.replace(destination / "data_manifest.json")


def publish_package(client, bucket, directory, manifest, asset_directory=None):
    # Assets must exist before clients can observe the newly released heroes.
    if asset_directory:
        for asset in sorted(asset_directory.rglob("*")):
            if asset.is_file():
                client.upload_file(str(asset), bucket, "assets/" + asset.relative_to(asset_directory).as_posix(), ExtraArgs={"ContentType": mimetypes.guess_type(asset.name)[0] or "application/octet-stream"})
    for artifact in manifest["artifacts"].values():
        client.upload_file(str(directory / artifact["file"]), bucket, artifact["file"], ExtraArgs={"ContentType": "application/json", "CacheControl": "public, max-age=31536000, immutable"})
    client.upload_file(str(directory / "data_manifest.json"), bucket, "data_manifest.json", ExtraArgs={"ContentType": "application/json", "CacheControl": "no-cache"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PUBLIC)
    parser.add_argument("--proposals", type=Path, default=MAPPINGS / "tactical_proposals")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    heroes = json.loads((MAPPINGS / "master_heroes_global.json").read_text(encoding="utf-8"))
    synergy = json.loads((MAPPINGS / "kpl_synergy_matrix.json").read_text(encoding="utf-8"))
    releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
    manifest, texts = build_package(heroes, synergy, releases, approved_profiles(args.proposals, heroes))
    write_package(args.output, manifest, texts)
    print(f"Dataset {manifest['dataset_version']}: {manifest['hero_count']} heroes, artifacts verified by SHA-256")
    if args.publish:
        from dotenv import load_dotenv
        import boto3
        from botocore.config import Config
        load_dotenv(Path(__file__).parent / ".env")
        required = ("R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")
        if not all(os.getenv(key) for key in required):
            parser.error("Konfigurasi object storage belum lengkap.")
        endpoint = os.environ["R2_ENDPOINT_URL"]
        client = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto" if "r2.cloudflarestorage.com" in endpoint else "us-east-1", config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))
        publish_package(client, os.environ["R2_BUCKET_NAME"], args.output, manifest, PUBLIC / "assets")
        print("Published: manifest uploaded last.")


if __name__ == "__main__":
    main()
