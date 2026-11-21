"""camp_source.py
Official HoK Camp API (Global) ingestion module for hok-draft-engine.

Connects to camp.honorofkings.com via hok-camp-api to extract:
- 120 Global released heroes (official English names, roles, lane recommendations)
- Official English skill descriptions, cooldowns, tags, and icons
- Seasonal balance adjustments (S16 revamp & balance patch notes)
- Syncs with data/mappings/hero_release_status.json and updates master_heroes_global.json abilities
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from hok import HOKClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"


def _load_json(path: Path, default: Any = None) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default if default is not None else {}


def _save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


async def fetch_camp_data():
    """Fetch all heroes, skills, and seasonal adjustments from HoK Camp API."""
    logger.info("Connecting to HoK Camp API...")
    async with HOKClient() as client:
        # 1. Fetch all 120 Global heroes brief info
        heroes_brief = await client.get_all_heroes()
        logger.info(f"Retrieved {len(heroes_brief)} heroes from HoK Camp API.")

        # 2. Fetch seasonal adjustments
        adjustments_raw = []
        try:
            rich_adj = await client.get_rich_seasonal_adjustments()
            for item in rich_adj:
                adj_data = item.adjust_data
                adjustments_raw.append({
                    "hero_id": adj_data.heroInfo.heroId if adj_data.heroInfo else None,
                    "hero_name": adj_data.heroInfo.heroName if adj_data.heroInfo else None,
                    "type": adj_data.type,
                    "short_desc": adj_data.shortDesc,
                    "tag": adj_data.contentTag.text if adj_data.contentTag else "",
                    "win_rate": adj_data.heroInfo.winningProbability if adj_data.heroInfo else None,
                    "pick_rate": adj_data.heroInfo.appearanceRate if adj_data.heroInfo else None,
                    "ban_rate": adj_data.heroInfo.banRote if adj_data.heroInfo else None,
                })
            logger.info(f"Retrieved {len(adjustments_raw)} seasonal adjustments.")
        except Exception as e:
            logger.warning(f"Failed to fetch seasonal adjustments: {e}")

        # 3. Fetch detailed skill data for each hero
        hero_skills = {}
        camp_heroes_list = []
        total = len(heroes_brief)
        logger.info(f"Fetching skill details for {total} heroes...")

        for idx, h in enumerate(heroes_brief, 1):
            hero_id = int(h.heroId)
            camp_heroes_list.append({
                "hero_id": hero_id,
                "name": h.heroName,
                "main_job": h.mainJob,
                "minor_job": h.minorJob,
                "main_job_name": h.mainJobName,
                "minor_job_name": h.minorJobName,
                "recommend_road": h.recommendRoad,
                "recommend_road_name": h.recommendRoadName,
                "icon": h.icon,
                "cover": h.cover,
            })

            # Fetch hero details with retry
            details = None
            for attempt in range(3):
                try:
                    details = await client.get_hero_details(hero_id)
                    break
                except Exception as e:
                    if attempt < 2:
                        await asyncio.sleep(0.5 * (attempt + 1))
                    else:
                        logger.error(f"Error fetching details for hero {hero_id} ({h.heroName}) after 3 attempts: {e}")

            if details:
                strategy_data = details.get("strategyData") or {}
                skill_blocks = strategy_data.get("skill") or []
                skills_list = []
                if skill_blocks and isinstance(skill_blocks, list):
                    raw_skills = skill_blocks[0].get("skillList") or []
                    for s_idx, s in enumerate(raw_skills):
                        skill_type_str = "Passive" if s_idx == 0 else f"Skill {s_idx}"
                        skills_list.append({
                            "skill_id": s.get("skillId"),
                            "type": skill_type_str,
                            "name": s.get("skillName", "").strip(),
                            "desc": s.get("skillDesc", "").strip(),
                            "cd": s.get("skillCd", 0),
                            "cost": s.get("skillCostList", {}).get("skillCost", 0) if isinstance(s.get("skillCostList"), dict) else 0,
                            "tags": [t.get("tagText", "").strip() for t in s.get("skillTag", []) if isinstance(t, dict) and t.get("tagText")],
                            "icon": s.get("skillIcon", ""),
                        })
                hero_skills[hero_id] = skills_list

            if idx % 20 == 0 or idx == total:
                logger.info(f"Progress: [{idx}/{total}] heroes detailed.")

        return camp_heroes_list, hero_skills, adjustments_raw


def update_release_status(camp_heroes: List[Dict[str, Any]], release_path: Path = MAPPINGS / "hero_release_status.json") -> Dict[str, Any]:
    """Ensure all heroes present in HoK Camp Global are marked released: True."""
    status = _load_json(release_path, {})
    changed = False

    for h in camp_heroes:
        hid = str(h["hero_id"])
        # Protect alias 511 -> 556
        if hid == "511":
            continue
        current = status.get(hid)
        if not current or not current.get("released"):
            status[hid] = {"released": True}
            changed = True
            logger.info(f"Marked hero {hid} ({h.get('name')}) as released in {release_path.name}")

    if changed:
        _save_json(release_path, status)
        logger.info(f"Updated {release_path}")
    return status


def update_master_heroes_abilities(hero_skills: Dict[int, List[Dict[str, Any]]], master_path: Path = MAPPINGS / "master_heroes_global.json") -> int:
    """Update master_heroes_global.json with official skill descriptions from Camp API."""
    master = _load_json(master_path, [])
    updated_count = 0

    for hero in master:
        hid = int(hero.get("hero_id", 0))
        if hid in hero_skills and hero_skills[hid]:
            new_skills = hero_skills[hid]
            old_skills = hero.get("abilities") or []

            # Check if skill count or text differs
            old_desc_blob = " ".join([s.get("desc", "") for s in old_skills])
            new_desc_blob = " ".join([s.get("desc", "") for s in new_skills])

            if old_desc_blob != new_desc_blob:
                hero["abilities"] = new_skills
                updated_count += 1

    if updated_count > 0:
        _save_json(master_path, master)
        logger.info(f"Updated abilities for {updated_count} heroes in {master_path.name}")
    return updated_count


def sync():
    """Main sync runner."""
    camp_heroes, hero_skills, adjustments = asyncio.run(fetch_camp_data())

    # Save raw outputs
    _save_json(MAPPINGS / "camp_heroes.json", camp_heroes)
    _save_json(MAPPINGS / "camp_skills.json", {str(k): v for k, v in hero_skills.items()})
    _save_json(MAPPINGS / "camp_adjustments.json", adjustments)

    # Sync release status and master hero abilities
    update_release_status(camp_heroes)
    updated_abilities = update_master_heroes_abilities(hero_skills)

    logger.info("HoK Camp API synchronization complete.")
    logger.info(f"Summary: {len(camp_heroes)} heroes, {len(hero_skills)} skillsets, {len(adjustments)} adjustments, {updated_abilities} master abilities updated.")


if __name__ == "__main__":
    sync()
