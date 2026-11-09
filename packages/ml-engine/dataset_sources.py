"""Shared source assembly for proposal generation and production packaging."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"


def _load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def attach_hokstats(heroes, hokstats_records, reviews=(), guide_reviews=()):
    review_index = {(int(x["hero_id"]), x["relation"], int(x["target_id"]), x["source_hash"]): x for x in reviews}
    guide_review_index = {(int(x["hero_id"]), x["source_hash"]): x for x in guide_reviews}
    by_id = {int(x["hero_id"]): x for x in hokstats_records}
    result = []
    for original in heroes:
        hero = dict(original)
        record = by_id.get(int(hero["hero_id"]))
        if record:
            guide = dict(record.get("guide") or {})
            guide_source = dict(guide.get("source") or {})
            guide_review = guide_review_index.get((int(hero["hero_id"]), guide_source.get("source_hash")))
            guide_source["review_status"] = guide_review["status"] if guide_review else "pending"
            if guide_review:
                guide_source["reviewed_by"] = guide_review["reviewed_by"]
            guide["source"] = guide_source
            matchups = []
            for matchup in guide.get("matchups", []):
                target_id = matchup.get("hero_id")
                if target_id is None:
                    continue
                source = dict(matchup.get("source") or {})
                review = review_index.get((int(hero["hero_id"]), matchup["relation"], int(target_id), source.get("source_hash")))
                source["review_status"] = review["status"] if review else "pending"
                if review:
                    source["reviewed_by"] = review["reviewed_by"]
                matchups.append({**matchup, "source": source})
            guide["matchups"] = matchups
            hero["hokstats_guide"] = guide
        result.append(hero)
    return result


def load_source_heroes(mappings=MAPPINGS):
    """Load the same source-enriched hero records used by proposal validation and publishing."""
    heroes = _load_json(mappings / "master_heroes_global.json", [])
    return attach_hokstats(
        heroes,
        _load_json(mappings / "hokstats_heroes.json", []),
        _load_json(mappings / "hokstats_matchup_reviews.json", []),
        _load_json(mappings / "hokstats_guide_reviews.json", []),
    )
