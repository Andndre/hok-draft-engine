"""cn_pvp_source.py
Tencent China Server (pvp.qq.com) ingestion module for hok-draft-engine.

Extracts:
- 115 Items (item.json): item_id, item_name, item_type, price, description
- 12 Summoner Spells (summoner.json): summoner_id, summoner_name, rank, description
- 93 Arcana (ming.json): ming_id, ming_name, ming_type (red, blue, green), ming_grade, description
- 140 Heroes list (herolist.json) and CN-exclusive hero details (herodetail/{id}.shtml)
  for KPL pro tournament simulation fidelity (e.g. Master Luban #525, Wu Zetian #136).
"""

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"

PVP_ENDPOINTS = {
    "items": "https://pvp.qq.com/web201605/js/item.json",
    "spells": "https://pvp.qq.com/web201605/js/summoner.json",
    "arcana": "https://pvp.qq.com/web201605/js/ming.json",
    "herolist": "https://pvp.qq.com/web201605/js/herolist.json",
}

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"


def _load_json(path: Path, default: Any = None) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default if default is not None else {}


def _save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def clean_html(text: str) -> str:
    """Strip HTML tags and normalize whitespace."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.split()).strip()


def sync_dictionaries(client: httpx.Client) -> Dict[str, Any]:
    """Download item, summoner spell, and arcana catalogs from Tencent CDN."""
    logger.info("Fetching item, summoner, and arcana catalogs from pvp.qq.com...")
    
    # 1. Items
    items_raw = client.get(PVP_ENDPOINTS["items"]).json()
    items = []
    for raw in items_raw:
        item_id = int(raw.get("item_id", 0))
        items.append({
            "id": item_id,
            "name": raw.get("item_name", "").strip(),
            "type": raw.get("item_type", 0),
            "price": raw.get("price", 0),
            "total_price": raw.get("total_price", 0),
            "desc": clean_html(raw.get("des1", "")),
            "icon_url": f"https://game.gtimg.cn/images/yxzj/img201606/itemimg/{item_id}.png",
        })
    _save_json(MAPPINGS / "cn_items.json", items)
    logger.info(f"Saved {len(items)} items to cn_items.json")

    # 2. Summoner Spells
    spells_raw = client.get(PVP_ENDPOINTS["spells"]).json()
    spells = []
    for raw in spells_raw:
        spell_id = int(raw.get("summoner_id", 0))
        spells.append({
            "id": spell_id,
            "name": raw.get("summoner_name", "").strip(),
            "rank": raw.get("summoner_rank", "").strip(),
            "desc": clean_html(raw.get("summoner_description", "")),
            "icon_url": f"https://game.gtimg.cn/images/yxzj/img201606/summoner/{spell_id}.jpg",
        })
    _save_json(MAPPINGS / "cn_spells.json", spells)
    logger.info(f"Saved {len(spells)} summoner spells to cn_spells.json")

    # 3. Arcana (Mingwen)
    arcana_raw = client.get(PVP_ENDPOINTS["arcana"]).json()
    arcana = []
    for raw in arcana_raw:
        ming_id = int(raw.get("ming_id", 0))
        arcana.append({
            "id": ming_id,
            "name": raw.get("ming_name", "").strip(),
            "type": raw.get("ming_type", "").strip(),
            "grade": int(raw.get("ming_grade", 0)),
            "desc": clean_html(raw.get("ming_des", "")),
            "icon_url": f"https://game.gtimg.cn/images/yxzj/img201606/mingwen/{ming_id}.png",
        })
    _save_json(MAPPINGS / "cn_arcana.json", arcana)
    logger.info(f"Saved {len(arcana)} arcana to cn_arcana.json")

    return {"items": items, "spells": spells, "arcana": arcana}


def fetch_cn_hero_detail(client: httpx.Client, hero_id: int, cname: str) -> Optional[Dict[str, Any]]:
    """Fetch skills and suggested builds for CN heroes from herodetail/{id}.shtml."""
    url = f"https://pvp.qq.com/web201605/herodetail/{hero_id}.shtml"
    try:
        resp = client.get(url, timeout=10.0)
        if resp.status_code != 200:
            logger.warning(f"CN hero detail not found for {hero_id} ({cname}): HTTP {resp.status_code}")
            return None
        resp.encoding = "gbk"
        soup = BeautifulSoup(resp.text, "html.parser")

        # Parse skills
        skills = []
        skill_containers = soup.find_all("div", class_="show-list")
        for idx, container in enumerate(skill_containers):
            p_name = container.find("p", class_="skill-name")
            p_desc = container.find("p", class_="skill-desc")
            if not p_name or not p_desc:
                continue
            name_text = p_name.get_text().strip()
            # Split skill name from cooldown/cost if attached
            m = re.match(r"^(.*?)(?:冷却值：(.*?)消耗：(.*?))?$", name_text)
            skill_name = m.group(1).strip() if m else name_text
            cd_val = m.group(2).strip() if m and m.group(2) else "0"
            cost_val = m.group(3).strip() if m and m.group(3) else "0"

            skill_type_str = "Passive" if idx == 0 else f"Skill {idx}"
            skills.append({
                "type": skill_type_str,
                "name": skill_name,
                "desc": p_desc.get_text().strip(),
                "cd": cd_val,
                "cost": cost_val,
                "icon_url": f"https://game.gtimg.cn/images/yxzj/img201606/heroimg/{hero_id}/{hero_id}{idx}0.png",
            })

        # Parse suggested items
        sugg_items = []
        sugg_div = soup.find("div", class_="sugg-item")
        if sugg_div:
            for item_elem in sugg_div.find_all(attrs={"data-item": True}):
                data_item = item_elem.get("data-item", "")
                if data_item:
                    try:
                        ids = [int(x) for x in data_item.split("|") if x.strip()]
                        if ids:
                            sugg_items.append(ids)
                    except ValueError:
                        pass

        return {
            "hero_id": hero_id,
            "chinese_name": cname,
            "skills": skills,
            "suggested_item_sets": sugg_items,
        }
    except Exception as e:
        logger.error(f"Failed to scrape CN hero {hero_id} ({cname}): {e}")
        return None


def sync_cn_heroes(client: httpx.Client, releases: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fetch unreleased/CN-exclusive hero skills for KPL simulator support."""
    logger.info("Fetching full hero list from pvp.qq.com...")
    herolist = client.get(PVP_ENDPOINTS["herolist"]).json()
    logger.info(f"Total heroes in pvp.qq.com herolist: {len(herolist)}")

    cn_heroes = []
    for h in herolist:
        hero_id = int(h.get("ename", 0))
        cname = h.get("cname", "").strip()
        rel_info = releases.get(str(hero_id), {})
        is_released_global = rel_info.get("released", False)

        # Scrape detail for unreleased / CN heroes
        if not is_released_global and hero_id != 511:
            logger.info(f"Scraping CN-exclusive hero details: {hero_id} ({cname})...")
            detail = fetch_cn_hero_detail(client, hero_id, cname)
            if detail:
                detail["title"] = h.get("title", "")
                detail["skin_name"] = h.get("skin_name", "")
                cn_heroes.append(detail)

    _save_json(MAPPINGS / "cn_heroes.json", cn_heroes)
    logger.info(f"Saved {len(cn_heroes)} CN-exclusive heroes to cn_heroes.json")
    return cn_heroes


def update_master_heroes_cn_abilities(
    cn_heroes_path: Path = MAPPINGS / "cn_heroes.json",
    master_path: Path = MAPPINGS / "master_heroes_global.json"
) -> int:
    """Attach scraped CN hero abilities to master_heroes_global.json for CN-exclusive heroes."""
    cn_heroes = _load_json(cn_heroes_path, [])
    master = _load_json(master_path, [])
    cn_dict = {int(h["hero_id"]): h for h in cn_heroes}
    updated = 0

    for hero in master:
        hid = int(hero.get("hero_id", 0))
        if hid in cn_dict and cn_dict[hid].get("skills"):
            cn_skills = cn_dict[hid]["skills"]
            formatted_abilities = []
            for s_idx, s in enumerate(cn_skills):
                formatted_abilities.append({
                    "skill_id": int(f"{hid}{s_idx:02d}"),
                    "type": s.get("type", "Passive" if s_idx == 0 else f"Skill {s_idx}"),
                    "name": s.get("name", "").strip(),
                    "desc": s.get("desc", "").strip(),
                    "cd": s.get("cd", 0),
                    "cost": s.get("cost", 0),
                    "tags": [],
                    "icon": s.get("icon_url", "")
                })
            hero["abilities"] = formatted_abilities
            updated += 1
            logger.info(f"Attached {len(formatted_abilities)} CN abilities for hero {hid} ({hero.get('name')})")

    if updated > 0:
        _save_json(master_path, master)
        logger.info(f"Updated {updated} CN heroes abilities in {master_path.name}")
    return updated


def sync():
    """Main CN sync runner."""
    releases = _load_json(MAPPINGS / "hero_release_status.json", {})
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=15.0, follow_redirects=True) as client:
        dicts = sync_dictionaries(client)
        cn_heroes = sync_cn_heroes(client, releases)
    update_master_heroes_cn_abilities()
    logger.info("CN pvp.qq.com synchronization complete.")


if __name__ == "__main__":
    sync()
