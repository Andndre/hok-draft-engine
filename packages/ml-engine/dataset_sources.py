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


def apply_counter_overrides(heroes, overrides=None):
    """Layer curated counter relations over the scraped roster, keeping both directions in sync.

    The Kurohiko article only lists matchups it happens to mention; mechanics that are obvious
    in game (a knockback cancelling a channelled ultimate) can be absent. Curated relations live
    in `hero_counter_overrides.json` so a roster re-sync cannot silently drop them. The merge is
    idempotent: a relation already present in either direction is left untouched.
    """
    overrides = overrides or []
    result = []
    for original in heroes:
        hero = dict(original)
        hero["counters"] = [dict(entry) for entry in original.get("counters") or []]
        hero["countered_by"] = [dict(entry) for entry in original.get("countered_by") or []]
        result.append(hero)
    by_id = {int(hero["hero_id"]): hero for hero in result}
    for relation in overrides:
        counter_id = int(relation["counter_id"])
        target_id = int(relation["target_id"])
        counter = by_id.get(counter_id)
        target = by_id.get(target_id)
        if counter is None or target is None:
            raise ValueError(f"Kurasi counter menunjuk hero yang tidak ada: {counter_id} -> {target_id}")
        already_present = any(
            entry.get("target_id") == target_id for entry in counter["counters"]
        ) or any(entry.get("counter_id") == counter_id for entry in target["countered_by"])
        if already_present:
            continue
        severity = relation.get("severity", "soft")
        if severity not in ("hard", "soft"):
            raise ValueError(f"Severity kurasi tidak dikenal: {severity} ({counter_id} -> {target_id})")
        reason = relation.get("reason", "")
        counter["counters"].append(
            {"target_id": target_id, "target_name": target["name"], "severity": severity, "reason": reason}
        )
        target["countered_by"].append(
            {"counter_id": counter_id, "counter_name": counter["name"], "severity": severity, "reason": reason}
        )
    return result


def load_source_heroes(mappings=MAPPINGS):
    """Load the same source-enriched hero records used by proposal validation and publishing."""
    heroes = _load_json(mappings / "master_heroes_global.json", [])
    heroes = apply_counter_overrides(heroes, _load_json(mappings / "hero_counter_overrides.json", {}).get("relations", []))
    return attach_hokstats(
        heroes,
        _load_json(mappings / "hokstats_heroes.json", []),
        _load_json(mappings / "hokstats_matchup_reviews.json", []),
        _load_json(mappings / "hokstats_guide_reviews.json", []),
    )
