"""asset_mirror.py
Visual Asset Downloader & Mirror for hok-draft-engine.

Synchronizes missing visual assets (heroes, items, summoner spells, arcana)
from Tencent CDN and HoK Camp into apps/web/public/assets/.
Operates idempotently: skips existing assets to prevent duplicate network traffic.
"""

import io
import json
import logging
from pathlib import Path
from typing import Any, Dict, List
import httpx
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
MAPPINGS = ROOT / "data/mappings"
PUBLIC_ASSETS = ROOT / "apps/web/public/assets"

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"


def _load_json(path: Path, default: Any = None) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default if default is not None else []


def mirror_items(client: httpx.Client, items_dir: Path = PUBLIC_ASSETS / "items") -> int:
    """Download missing item icons from Tencent CDN."""
    items_dir.mkdir(parents=True, exist_ok=True)
    cn_items = _load_json(MAPPINGS / "cn_items.json", [])
    downloaded = 0

    for item in cn_items:
        item_id = item.get("id")
        if not item_id:
            continue
        target_png = items_dir / f"{item_id}.png"
        if target_png.exists():
            continue

        url = f"https://game.gtimg.cn/images/yxzj/img201606/itemimg/{item_id}.png"
        try:
            resp = client.get(url, timeout=10.0)
            if resp.status_code == 200:
                target_png.write_bytes(resp.content)
                downloaded += 1
                logger.info(f"Downloaded item icon: {item_id}.png ({item.get('name')})")
        except Exception as e:
            logger.warning(f"Failed to download item icon {item_id}: {e}")

    logger.info(f"Items mirror complete: {downloaded} new icons downloaded.")
    return downloaded


def mirror_spells(client: httpx.Client, spells_dir: Path = PUBLIC_ASSETS / "skills") -> int:
    """Download missing summoner spell icons from Tencent CDN."""
    spells_dir.mkdir(parents=True, exist_ok=True)
    cn_spells = _load_json(MAPPINGS / "cn_spells.json", [])
    downloaded = 0

    for spell in cn_spells:
        spell_id = spell.get("id")
        if not spell_id:
            continue
        target_png = spells_dir / f"{spell_id}.png"
        if target_png.exists():
            continue

        url = f"https://game.gtimg.cn/images/yxzj/img201606/summoner/{spell_id}.jpg"
        try:
            resp = client.get(url, timeout=10.0)
            if resp.status_code == 200:
                # Convert jpg to png for consistency
                img = Image.open(io.BytesIO(resp.content))
                img.save(target_png, format="PNG")
                downloaded += 1
                logger.info(f"Downloaded summoner spell icon: {spell_id}.png ({spell.get('name')})")
        except Exception as e:
            logger.warning(f"Failed to download summoner icon {spell_id}: {e}")

    logger.info(f"Spells mirror complete: {downloaded} new icons downloaded.")
    return downloaded


def mirror_arcana(client: httpx.Client, arcana_dir: Path = PUBLIC_ASSETS / "arcana") -> int:
    """Download missing arcana icons from Tencent CDN."""
    arcana_dir.mkdir(parents=True, exist_ok=True)
    cn_arcana = _load_json(MAPPINGS / "cn_arcana.json", [])
    downloaded = 0

    for arc in cn_arcana:
        ming_id = arc.get("id")
        if not ming_id:
            continue
        target_png = arcana_dir / f"{ming_id}.png"
        if target_png.exists():
            continue

        url = f"https://game.gtimg.cn/images/yxzj/img201606/mingwen/{ming_id}.png"
        try:
            resp = client.get(url, timeout=10.0)
            if resp.status_code == 200:
                target_png.write_bytes(resp.content)
                downloaded += 1
                logger.info(f"Downloaded arcana icon: {ming_id}.png ({arc.get('name')})")
        except Exception as e:
            logger.warning(f"Failed to download arcana icon {ming_id}: {e}")

    logger.info(f"Arcana mirror complete: {downloaded} new icons downloaded.")
    return downloaded


def mirror_hero_portraits(client: httpx.Client, heroes_dir: Path = PUBLIC_ASSETS / "heroes") -> int:
    """Download missing hero portraits into webp format."""
    heroes_dir.mkdir(parents=True, exist_ok=True)
    camp_heroes = _load_json(MAPPINGS / "camp_heroes.json", [])
    downloaded = 0

    for hero in camp_heroes:
        hero_id = hero.get("hero_id")
        if not hero_id:
            continue
        target_webp = heroes_dir / f"{hero_id}.webp"
        if target_webp.exists():
            continue

        icon_url = hero.get("icon") or f"https://game.gtimg.cn/images/yxzj/img201606/heroimg/{hero_id}/{hero_id}.jpg"
        try:
            resp = client.get(icon_url, timeout=10.0)
            if resp.status_code == 200:
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                img.thumbnail((128, 128))
                img.save(target_webp, format="WEBP", quality=85)
                downloaded += 1
                logger.info(f"Downloaded and converted hero portrait: {hero_id}.webp ({hero.get('name')})")
        except Exception as e:
            logger.warning(f"Failed to download hero portrait {hero_id}: {e}")

    logger.info(f"Hero portraits mirror complete: {downloaded} new portraits downloaded.")
    return downloaded


def mirror_abilities(client: httpx.Client, abilities_dir: Path = PUBLIC_ASSETS / "abilities") -> int:
    """Download missing hero ability / skill icons into PNG format."""
    abilities_dir.mkdir(parents=True, exist_ok=True)
    master_heroes = _load_json(MAPPINGS / "master_heroes_global.json", [])
    cn_heroes = _load_json(MAPPINGS / "cn_heroes.json", [])
    downloaded = 0

    all_heroes = list(master_heroes)
    master_ids = {h.get("hero_id") for h in master_heroes}
    for ch in cn_heroes:
        if ch.get("hero_id") not in master_ids:
            all_heroes.append(ch)

    for hero in all_heroes:
        hero_id = hero.get("hero_id")
        if not hero_id:
            continue
        abilities = hero.get("abilities") or []
        for idx, ab in enumerate(abilities):
            target_png = abilities_dir / f"{hero_id}-{idx}.png"
            if target_png.exists():
                continue

            icon_url = ab.get("icon")
            if not icon_url:
                continue

            try:
                resp = client.get(icon_url, timeout=10.0)
                if resp.status_code == 200:
                    img = Image.open(io.BytesIO(resp.content))
                    img.save(target_png, format="PNG")
                    downloaded += 1
                    logger.info(f"Downloaded ability icon: {hero_id}-{idx}.png ({hero.get('name')} - {ab.get('name')})")
            except Exception as e:
                logger.warning(f"Failed to download ability icon {hero_id}-{idx} from {icon_url}: {e}")

    logger.info(f"Abilities mirror complete: {downloaded} new icons downloaded.")
    return downloaded


def sync():
    """Main asset mirror runner."""
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=15.0, follow_redirects=True) as client:
        mirror_items(client)
        mirror_spells(client)
        mirror_arcana(client)
        mirror_hero_portraits(client)
        mirror_abilities(client)
    logger.info("Asset mirror synchronization finished.")


if __name__ == "__main__":
    sync()
