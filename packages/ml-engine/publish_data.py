"""Build a versioned immutable dataset package and update data_manifest.json."""
import argparse
import hashlib
import json
from pathlib import Path
from tactical_profiles import approved_profiles
from dataset_sources import attach_hokstats, load_source_heroes
from hokstats_source import norm

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"
PUBLIC = ROOT / "apps/web/public"


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def build_catalogs(hokfire_items, hokfire_spells, hokstats_items=(), hokstats_spells=(), catalog_reviews=()):
    review_index = {(x["kind"], str(x["record_id"]), x["source_hash"]): x for x in catalog_reviews}

    def reviewed_source(kind, record, record_id):
        source = dict(record.get("source") or {})
        review = review_index.get((kind, str(record_id), source.get("source_hash")))
        source["review_status"] = review["status"] if review else "pending"
        if review:
            source["reviewed_by"] = review["reviewed_by"]
        return source

    items = {}
    for raw in hokfire_items:
        name = raw.get("name", "")
        key = str(raw.get("id") or norm(name))
        items[key] = {"id": raw.get("id"), "name": name, "type": raw.get("type", ""), "desc": raw.get("desc", ""), "icon": f"/assets/items/{raw.get('id')}.png" if raw.get("id") else "", "sources": {"hokfire": {"description": raw.get("desc", ""), "source": {"source": "HOKFIRE", "url": "https://www.hokfire.com/"}}}}
    name_index = {norm(item["name"]): key for key, item in items.items()}
    for raw in hokstats_items:
        key = str(raw.get("local_id") or raw.get("id") or name_index.get(norm(raw.get("name")), norm(raw.get("name"))))
        item = items.get(key) or items.get(name_index.get(norm(raw.get("name"))))
        if not item:
            item = {"id": raw.get("local_id") or raw.get("id"), "name": raw.get("name", ""), "type": "", "desc": "", "icon": f"/assets/items/{raw.get('local_id') or raw.get('id')}.png" if raw.get("local_id") or raw.get("id") else "", "sources": {}}
            items[key] = item
        details = {k: v for k, v in raw.items() if k not in ("id", "local_id", "name")}
        details["source"] = reviewed_source("item", raw, raw.get("local_id") or raw.get("id") or norm(raw.get("name")))
        item.setdefault("sources", {})["hokstats"] = details
        if raw.get("local_id") and not item.get("id"):
            item["id"] = raw["local_id"]

    spells = {}
    for name, description in hokfire_spells.items():
        spells[norm(name)] = {"id": norm(name), "name": name, "effect": description, "icon": f"/assets/skills/{name.lower().strip()}.png", "sources": {"hokfire": {"effect": description, "source": {"source": "HOKFIRE", "url": "https://www.hokfire.com/"}}}}
    for raw in hokstats_spells:
        key = norm(raw.get("name"))
        spell = spells.get(key) or {"id": raw.get("id", key), "name": raw.get("name", ""), "effect": "", "icon": f"/assets/skills/{key}.png", "sources": {}}
        details = {k: v for k, v in raw.items() if k not in ("id", "name")}
        details["source"] = reviewed_source("spell", raw, raw.get("id") or key)
        spell["sources"]["hokstats"] = details
        spells[key] = spell
    return list(items.values()), list(spells.values())


def build_package(heroes, synergy, releases, profiles=None, items=None, spells=None):
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
    texts = {"heroes": encode(output), "synergy": encode(synergy), "releases": encode(releases), "items": encode(items or []), "spells": encode(spells or [])}
    hashes = {key: hashlib.sha256(value).hexdigest() for key, value in texts.items()}
    version = hashlib.sha256(encode(hashes)).hexdigest()[:16]
    names = {"heroes": "hero_metadata.json", "synergy": "kpl_synergy_matrix.json", "releases": "hero_release_status.json", "items": "item_catalog.json", "spells": "spell_catalog.json"}
    manifest = {"schema_version": 2, "dataset_version": version, "hero_count": len(output), "artifacts": {key: {"file": f"datasets/{version}/{names[key]}", "sha256": hashes[key]} for key in texts}}
    return manifest, texts


def write_package(destination, manifest, texts):
    destination.mkdir(parents=True, exist_ok=True)
    for key, contents in texts.items():
        target = destination / manifest["artifacts"][key]["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != contents:
            raise ValueError("Artefak immutable sudah ada dengan isi berbeda.")
        if not target.exists():
            temporary_artifact = target.with_suffix(".json.tmp")
            temporary_artifact.write_bytes(contents)
            temporary_artifact.replace(target)
    temporary = destination / "data_manifest.json.tmp"
    temporary.write_bytes(encode(manifest))
    temporary.replace(destination / "data_manifest.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PUBLIC)
    parser.add_argument("--proposals", type=Path, default=MAPPINGS / "tactical_proposals")
    args = parser.parse_args()
    synergy = json.loads((MAPPINGS / "kpl_synergy_matrix.json").read_text(encoding="utf-8"))
    releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
    source_heroes = load_source_heroes(MAPPINGS)
    items, spells = build_catalogs(
        _load_json(MAPPINGS / "items_hokfire_full.json", []),
        _load_json(MAPPINGS / "skills_hokfire.json", {}),
        _load_json(MAPPINGS / "hokstats_items.json", []),
        _load_json(MAPPINGS / "hokstats_spells.json", []),
        _load_json(MAPPINGS / "hokstats_catalog_reviews.json", []),
    )
    manifest, texts = build_package(source_heroes, synergy, releases, approved_profiles(args.proposals, source_heroes), items, spells)
    write_package(args.output, manifest, texts)
    print(f"Dataset {manifest['dataset_version']}: {manifest['hero_count']} heroes, artifacts verified by SHA-256")


if __name__ == "__main__":
    main()
