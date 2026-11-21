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

    Provenance is explicit: scraped relations carry `source: "kurohiko"`, curated ones carry
    `source: "curation"` plus reviewer and date. Without it the wiki would credit a manual
    reading of skill text to the Kurohiko article.
    """
    overrides = overrides or []
    result = []
    for original in heroes:
        hero = dict(original)
        hero["counters"] = [dict(entry) for entry in original.get("counters") or []]
        hero["countered_by"] = [dict(entry) for entry in original.get("countered_by") or []]
        for entry in hero["counters"]:
            entry.setdefault("source", "kurohiko")
        for entry in hero["countered_by"]:
            entry.setdefault("source", "kurohiko")
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
        provenance = {
            "source": "curation",
            "reviewed_by": relation.get("reviewed_by", "Draft engine curation"),
            "reviewed_at": relation.get("reviewed_at"),
        }
        counter["counters"].append(
            {
                "target_id": target_id,
                "target_name": target["name"],
                "severity": severity,
                "reason": reason,
                **provenance,
            }
        )
        target["countered_by"].append(
            {
                "counter_id": counter_id,
                "counter_name": counter["name"],
                "severity": severity,
                "reason": reason,
                **provenance,
            }
        )
    return result


def apply_measured_matchups(heroes, measured=None):
    """Layer measured KPL matchup evidence over the roster.

    `data/mappings/hero_measured_matchups.json` (built by `extract_kpl_matchups.py`) carries
    measured hero-vs-hero effects: delta = winrate(x | y opposing) - winrate(x | y absent from
    the draft). Those numbers are evidence, not curation, so every attached entry is labelled
    `source: "kpl_measured"` — the same provenance discipline as `kurohiko` | `curation`.

    Only heroes present in the measured payload are touched; a missing/empty payload attaches
    nothing, so publishing keeps working before the extractor has ever run. Input dicts are
    never mutated.
    """
    entries = (measured or {}).get("heroes") or {}
    result = []
    for original in heroes:
        hero = dict(original)
        record = entries.get(str(hero["hero_id"]))
        if record:
            hero["measured_counters"] = [
                {**dict(entry), "source": "kpl_measured"} for entry in record.get("measured_counters") or []
            ]
            hero["measured_countered_by"] = [
                {**dict(entry), "source": "kpl_measured"} for entry in record.get("measured_countered_by") or []
            ]
            hero["measured_meta"] = dict(record.get("measured_meta") or {})
        result.append(hero)
    return result


def apply_skill_overrides(heroes, overrides_payload):
    """Apply curated skill mechanics, custom descriptions, and stance metadata idempotently.
    
    Guarantees that hero mode/combo skills and tactical clarifications survive scraper re-syncs.
    """
    by_hero = (overrides_payload or {}).get("heroes") or {}
    result = []
    for original in heroes:
        hero = dict(original)
        hid_str = str(hero.get("hero_id") or hero.get("id"))
        override = by_hero.get(hid_str)
        if override:
            if override.get("stances"):
                hero["skill_stances_meta"] = list(override["stances"])
            if override.get("recast_skills"):
                hero["recast_skills_meta"] = list(override["recast_skills"])
            if override.get("variant_assets"):
                hero["variant_assets"] = list(override["variant_assets"])

            skill_map = override.get("skill_overrides") or {}
            guide = hero.get("hokstats_guide")
            if guide and guide.get("skills"):
                new_guide = dict(guide)
                updated_skills = []
                for s in new_guide.get("skills") or []:
                    s_copy = dict(s)
                    s_name = s_copy.get("name")
                    if s_name in skill_map:
                        so = skill_map[s_name]
                        if so.get("desc"):
                            s_copy["description"] = so["desc"]
                        if so.get("type"):
                            s_copy["type"] = so["type"]
                        if so.get("combo_badge"):
                            s_copy["combo_badge"] = so["combo_badge"]
                        if so.get("stance_id"):
                            s_copy["stance_id"] = so["stance_id"]
                    updated_skills.append(s_copy)
                new_guide["skills"] = updated_skills
                hero["hokstats_guide"] = new_guide

        result.append(hero)
    return result


def load_source_heroes(mappings=MAPPINGS):
    """Load the same source-enriched hero records used by proposal validation and publishing."""
    heroes = _load_json(mappings / "master_heroes_global.json", [])
    heroes = apply_counter_overrides(heroes, _load_json(mappings / "hero_counter_overrides.json", {}).get("relations", []))
    heroes = apply_measured_matchups(heroes, _load_json(mappings / "hero_measured_matchups.json", {}))
    heroes = attach_hokstats(
        heroes,
        _load_json(mappings / "hokstats_heroes.json", []),
        _load_json(mappings / "hokstats_matchup_reviews.json", []),
        _load_json(mappings / "hokstats_guide_reviews.json", []),
    )
    return apply_skill_overrides(heroes, _load_json(mappings / "hero_skill_overrides.json", {}))
