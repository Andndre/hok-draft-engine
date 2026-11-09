import asyncio
import httpx
import json
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_ASSETS = BASE_DIR / "data" / "assets"
PUBLIC_ASSETS = BASE_DIR / "apps" / "web" / "public" / "assets"
DIST_ASSETS = BASE_DIR / "apps" / "web" / "dist" / "assets"

HOK_SUPABASE = "https://dvdzmjovcpdofvhspoay.supabase.co/storage/v1/object/public/hero-img"
HOK_SITE = "https://www.hokfire.com/assets/img"

# Concurrency limiter
SEMAPHORE = asyncio.Semaphore(15)

async def download_file(client: httpx.AsyncClient, urls: list[str], dest_path: Path) -> bool:
    if dest_path.exists() and dest_path.stat().st_size > 100:
        return True # already downloaded
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    
    async with SEMAPHORE:
        for url in urls:
            try:
                res = await client.get(url, timeout=12.0)
                if res.status_code == 200 and len(res.content) > 100:
                    dest_path.write_bytes(res.content)
                    return True
            except Exception:
                continue
    return False

async def main():
    print("=== STARTING HOKFIRE ASSET SYNC ===")
    
    # 1. Load mappings
    items_file = BASE_DIR / "data" / "mappings" / "items_hokfire_full.json"
    arcana_file = BASE_DIR / "data" / "mappings" / "arcana_hokfire_full.json"
    skills_file = BASE_DIR / "data" / "mappings" / "skills_hokfire.json"
    heroes_file = BASE_DIR / "apps" / "web" / "public" / "hero_metadata.json"
    
    with open(items_file, "r", encoding="utf-8") as f:
        items = json.load(f)
    with open(arcana_file, "r", encoding="utf-8") as f:
        arcana = json.load(f)
    with open(skills_file, "r", encoding="utf-8") as f:
        skills = json.load(f)
    with open(heroes_file, "r", encoding="utf-8") as f:
        heroes = json.load(f)
        
    print(f"Loaded {len(items)} items, {len(arcana)} arcana, {len(skills)} skills, {len(heroes)} heroes.")

    tasks = []
    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        # Download Items
        for it in items:
            item_id = it["id"]
            dest = DATA_ASSETS / "items" / f"{item_id}.png"
            urls = [
                f"{HOK_SUPABASE}/items/{item_id}.png",
                f"{HOK_SITE}/items/{item_id}.png"
            ]
            tasks.append(download_file(client, urls, dest))
            
        # Download Arcana
        for arc in arcana:
            arc_id = arc["id"]
            dest = DATA_ASSETS / "arcana" / f"{arc_id}.png"
            urls = [
                f"{HOK_SUPABASE}/arcana/{arc_id}.png",
                f"{HOK_SITE}/arcana/{arc_id}.png"
            ]
            tasks.append(download_file(client, urls, dest))
            
        # Download Common Skills (Summoner spells)
        for sk_name in skills.keys():
            sk_lower = sk_name.lower().strip()
            dest = DATA_ASSETS / "skills" / f"{sk_lower}.png"
            urls = [
                f"{HOK_SUPABASE}/skills/{sk_lower}.png",
                f"{HOK_SITE}/skills/{sk_lower}.png"
            ]
            tasks.append(download_file(client, urls, dest))
            
        # Download Hero Abilities (Skill icons 0 to 4)
        for h in heroes:
            # We check hero_id or cdnId
            hero_id = h.get("hero_id")
            for idx in range(5): # 0: passive, 1: skill 1, 2: skill 2, 3: skill 3 / ult, 4: extra
                dest = DATA_ASSETS / "abilities" / f"{hero_id}-{idx}.png"
                urls = [
                    f"{HOK_SUPABASE}/abilities/{hero_id}-{idx}.png",
                    f"https://game.gtimg.cn/images/yxzj/img201606/heroimg/{hero_id}/{hero_id}{idx}0.png",
                    f"https://camp.honorofkings.com/Global/Common/UGUI/SystemRes/902_HeroSkillIcon/{hero_id}{idx}0.png",
                    f"{HOK_SITE}/abilities/{hero_id}-{idx}.png"
                ]
                tasks.append(download_file(client, urls, dest))
                
        print(f"Total asset download tasks queued: {len(tasks)}. Executing...")
        results = await asyncio.gather(*tasks)
        successful = sum(1 for r in results if r)
        print(f"Download complete: {successful}/{len(tasks)} assets ready.")

    # 2. Stage assets to apps/web/public/assets and apps/web/dist/assets
    for sub in ["items", "arcana", "skills", "abilities"]:
        src_sub = DATA_ASSETS / sub
        pub_sub = PUBLIC_ASSETS / sub
        dist_sub = DIST_ASSETS / sub
        
        pub_sub.mkdir(parents=True, exist_ok=True)
        dist_sub.mkdir(parents=True, exist_ok=True)
        
        if src_sub.exists():
            for f in src_sub.glob("*.png"):
                shutil.copy2(f, pub_sub / f.name)
                shutil.copy2(f, dist_sub / f.name)
    print("Synced assets to apps/web/public/assets and apps/web/dist/assets.")

    # 3. Create quick lookup dictionaries for web frontend
    # item_name_lower -> { id, name, type, desc, icon_url }
    item_map = {}
    for it in items:
        clean = it["name"].lower().strip()
        item_map[clean] = {
            "id": it["id"],
            "name": it["name"],
            "type": it.get("type", ""),
            "desc": it.get("desc", ""),
            "icon_url": f"/assets/items/{it['id']}.png"
        }
        
    # arcana_id / arcana_name_lower -> { id, name, color, desc, icon_url }
    arcana_map = {}
    arcana_id_map = {}
    for arc in arcana:
        clean = arc["name"].lower().strip()
        data = {
            "id": arc["id"],
            "name": arc["name"],
            "color": arc.get("color", ""),
            "desc": arc.get("desc", ""),
            "icon_url": f"/assets/arcana/{arc['id']}.png"
        }
        arcana_map[clean] = data
        arcana_id_map[str(arc["id"])] = data
        
    with open(BASE_DIR / "apps" / "web" / "public" / "items_map.json", "w", encoding="utf-8") as f:
        json.dump(item_map, f, indent=2)
    with open(BASE_DIR / "apps" / "web" / "dist" / "items_map.json", "w", encoding="utf-8") as f:
        json.dump(item_map, f, indent=2)

    with open(BASE_DIR / "apps" / "web" / "public" / "arcana_map.json", "w", encoding="utf-8") as f:
        json.dump(arcana_map, f, indent=2)
    with open(BASE_DIR / "apps" / "web" / "dist" / "arcana_map.json", "w", encoding="utf-8") as f:
        json.dump(arcana_map, f, indent=2)

    # 4. Enrich hero_metadata with resolved Arcana names and spell icons
    for h in heroes:
        if "hokfire_guide" in h and h["hokfire_guide"]:
            guide = h["hokfire_guide"]
            if "arcana" in guide and isinstance(guide["arcana"], list):
                resolved_arcana = []
                for arc_entry in guide["arcana"]:
                    name = arc_entry.get("name", "")
                    count = arc_entry.get("count", 10)
                    
                    # check if #id pattern
                    import re
                    m = re.search(r"#(\d+)", name)
                    if m and m.group(1) in arcana_id_map:
                        info = arcana_id_map[m.group(1)]
                        resolved_arcana.append({
                            "name": info["name"],
                            "id": info["id"],
                            "color": info["color"],
                            "desc": info["desc"],
                            "count": count,
                            "icon_url": info["icon_url"]
                        })
                    elif name.lower().strip() in arcana_map:
                        info = arcana_map[name.lower().strip()]
                        resolved_arcana.append({
                            "name": info["name"],
                            "id": info["id"],
                            "color": info["color"],
                            "desc": info["desc"],
                            "count": count,
                            "icon_url": info["icon_url"]
                        })
                    else:
                        resolved_arcana.append(arc_entry)
                guide["arcana"] = resolved_arcana
                
            if "spell" in guide and guide["spell"]:
                spell_clean = guide["spell"].lower().strip()
                guide["spell_icon"] = f"/assets/skills/{spell_clean}.png"

    # Save enriched hero_metadata
    with open(BASE_DIR / "apps" / "web" / "public" / "hero_metadata.json", "w", encoding="utf-8") as f:
        json.dump(heroes, f, indent=2)
    with open(BASE_DIR / "apps" / "web" / "dist" / "hero_metadata.json", "w", encoding="utf-8") as f:
        json.dump(heroes, f, indent=2)
    with open(BASE_DIR / "data" / "mappings" / "master_heroes_global.json", "w", encoding="utf-8") as f:
        json.dump(heroes, f, indent=2)

    print("=== FINISHED ASSET DOWNLOAD & ENRICHMENT ===")

if __name__ == "__main__":
    asyncio.run(main())
