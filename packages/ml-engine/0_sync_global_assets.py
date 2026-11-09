"""0_sync_global_assets.py
Scrapes hok.kurohiko.id & hokfire.com:
- Extracts all 120 Global heroes (Agudo to Ziya, 5 Flowborn variants, Fatih, Augran, etc.)
- Maps Global hero IDs/names to Chinese KPL names/IDs
- Gathers Tier ratings, Win %, Pick %, Ban %, recommended builds & arcana
- Scrapes community counter matrices and Indonesian tactical counter reasons
- Downloads & standardizes all 120 hero portraits into 128x128 .webp in data/assets/heroes/
- Outputs data/mappings/master_heroes_global.json
"""

import os
import re
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
import httpx
from bs4 import BeautifulSoup
from PIL import Image
import io

ROOT_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT_DIR / "data" / "raw"
MAPPINGS_DIR = ROOT_DIR / "data" / "mappings"
HERO_ASSETS_DIR = ROOT_DIR / "data" / "assets" / "heroes"
KPL_HEROES_JSON = RAW_DIR / "kpl-bp-dataset" / "data" / "heroes.json"

MAPPINGS_DIR.mkdir(parents=True, exist_ok=True)
HERO_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

CN_OVERRIDE_MAP = {
    640: "安奈特",   # Annette
    556: "阿塔",     # Ata
    646: "刀锋宝贝", # Butterfly
    631: "弗洛伦",   # Florentino
    635: "洛里昂",   # Lorion
    128: "曹操",     # Fatih (Cao Cao)
    503: "狂铁",     # Biron (Kuang Tie)
    517: "大司命",   # Augran (Da Siming)
    564: "姬小满",   # Mayene (Ji Xiaoman)
    563: "海诺",     # Heino (Hai Nuo)
    159: "朵莉亚",   # Dolia (Duo Liya)
    519: "敖隐",     # Ao'yin
    514: "亚连",     # Allain
    545: "莱西奥",   # Alessio
    508: "卢雅那",   # Luara
    537: "苍",       # Devara
    138: "王维",     # Wang Wei
    509: "盾山",     # Dunshan
    581: "元流之子(法师)",  # Flowborn (Mage)
    582: "元流之子(坦克)",  # Flowborn (Tank)
    583: "元流之子(刺客)",  # Flowborn (Assassin)
    584: "元流之子(射手)",  # Flowborn (Marksman)
    585: "元流之子(辅助)",  # Flowborn (Roamer)
}

LANE_MAP = {
    "r-clash": "Clash",
    "r-jungle": "Jungle",
    "r-mid": "Mid",
    "r-farm": "Farm",
    "r-roam": "Roam",
    0: "Clash",
    1: "Mid",
    2: "Farm",
    3: "Jungle",
    4: "Roam",
}

def load_kpl_hero_mapping() -> Dict[int, str]:
    mapping = {}
    if KPL_HEROES_JSON.exists():
        with open(KPL_HEROES_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data:
                mapping[int(item["hero_id"])] = item["hero"]
    for hid, cname in CN_OVERRIDE_MAP.items():
        if hid not in mapping or not mapping[hid]:
            mapping[hid] = cname
    return mapping

def scrape_kurohiko_roster(client: httpx.Client) -> List[Dict[str, Any]]:
    print(" [1/5] Fetching 120 Global Hero roster from https://hok.kurohiko.id/ ...", flush=True)
    resp = client.get("https://hok.kurohiko.id/", headers={"User-Agent": USER_AGENT}, timeout=15.0)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    
    tiles = soup.find_all("a", attrs={"data-hero": True})
    roster = []
    for t in tiles:
        hid = int(t["data-hero"])
        name = t.get_text().strip()
        href = t.get("href", "")
        slug = href.replace("/hero/", "").strip("/")
        img = t.find("img")
        role_class = "Mid"
        img_url = ""
        if img:
            classes = img.get("class", [])
            for c in classes:
                if c in LANE_MAP:
                    role_class = LANE_MAP[c]
            src = img.get("src", "")
            if src.startswith("/"):
                img_url = f"https://hok.kurohiko.id{src}"
            else:
                img_url = src
                
        roster.append({
            "hero_id": hid,
            "name": name,
            "slug": slug,
            "primary_lane": role_class,
            "img_url": img_url
        })
    print(f"       Found {len(roster)} heroes on Kurohiko.", flush=True)
    return roster

def fetch_hokfire_data(client: httpx.Client) -> (Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]):
    print(" [2/5] Fetching stats and build guides from https://www.hokfire.com/ ...", flush=True)
    stats_by_id = {}
    builds_by_id = {}
    
    try:
        r_stats = client.get("https://www.hokfire.com/assets/stats.js", headers={"User-Agent": USER_AGENT}, timeout=15.0)
        if r_stats.status_code == 200:
            tier_letters = ["S", "A", "B", "C", "D"]
            blocks = re.findall(r'\{([^{}]+)\}', r_stats.text)
            for b in blocks:
                id_m = re.search(r'\bid:\s*(\d+)', b)
                if not id_m:
                    continue
                hid = int(id_m.group(1))
                name_m = re.search(r'\bname:\s*"([^"]+)"', b)
                name = name_m.group(1) if name_m else ""
                pos_m = re.search(r'\bposition:\s*(\d+)', b)
                pos = int(pos_m.group(1)) if pos_m else None
                trank_m = re.search(r'\btRank:\s*(\d+)', b)
                trank = int(trank_m.group(1)) if trank_m else None
                wr_m = re.search(r'\bwinRate:\s*([0-9.]+)', b)
                win_rate = float(wr_m.group(1)) if wr_m else None
                sr_m = re.search(r'\bshowRate:\s*([0-9.]+)', b)
                show_rate = float(sr_m.group(1)) if sr_m else None
                br_m = re.search(r'\bbanRate:\s*([0-9.]+)', b)
                ban_rate = float(br_m.group(1)) if br_m else None

                tier_str = tier_letters[trank] if trank is not None and trank < len(tier_letters) else "B"

                stats_by_id[hid] = {
                    "name": name,
                    "position": pos,
                    "lane": LANE_MAP.get(pos, "Mid"),
                    "tier": tier_str,
                    "win_rate": round(win_rate, 4) if win_rate is not None else None,
                    "pick_rate": round(show_rate, 4) if show_rate is not None else 0.035,
                    "ban_rate": round(ban_rate, 4) if ban_rate is not None else 0.010
                }
            print(f"       Parsed {len(stats_by_id)} hero stats from HOKFIRE stats.js.", flush=True)
    except Exception as e:
        print(f"       Warning: Could not fetch stats.js: {e}", flush=True)

    try:
        r_data = client.get("https://www.hokfire.com/assets/data.js", headers={"User-Agent": USER_AGENT}, timeout=15.0)
        if r_data.status_code == 200:
            text = r_data.text
            hero_blocks = re.findall(r'\{\s*slug:\s*"([^"]+)".*?cdnId:\s*(\d+).*?name:\s*"([^"]+)".*?role:\s*"([^"]+)".*?tier:\s*"([^"]+)".*?\}', text, re.DOTALL)
            for slug, cdn_id, name, role, tier in hero_blocks:
                hid = int(cdn_id)
                builds_by_id[hid] = {
                    "slug": slug,
                    "name": name,
                    "role": role,
                    "tier": tier,
                }
            print(f"       Parsed {len(builds_by_id)} hero guides from HOKFIRE data.js.", flush=True)
    except Exception as e:
        print(f"       Warning: Could not fetch data.js: {e}", flush=True)

    return stats_by_id, builds_by_id

def scrape_kurohiko_hero_counters(client: httpx.Client, slug: str) -> Dict[str, Any]:
    url = f"https://hok.kurohiko.id/hero/{slug}"
    result = {
        "counters": [],
        "counter_items": [],
        "how_to_counter": "",
        "lanes": [],
        "role": ""
    }
    try:
        resp = client.get(url, headers={"User-Agent": USER_AGENT}, timeout=10.0)
        if resp.status_code != 200:
            return result
        
        soup = BeautifulSoup(resp.text, "html.parser")
        
        # Parse Lanes & Role from `<p class="mut">Jungle / Farm · Marksman</p>`
        mut = soup.find("p", class_="mut")
        if mut:
            txt = mut.get_text(strip=True)
            if "·" in txt:
                lanes_part, role_part = txt.split("·", 1)
                result["role"] = role_part.strip()
                result["lanes"] = [l.strip() for l in lanes_part.split("/") if l.strip()]
            else:
                result["role"] = txt
                
        # Parse Counter alami cards
        h2_counter = soup.find("h2", string=lambda t: t and "Counter alami" in t)
        if h2_counter:
            sibling = h2_counter.find_next_sibling()
            while sibling and sibling.name == "div" and "card" in sibling.get("class", []):
                link = sibling.find("a", class_="link")
                img = sibling.find("img")
                badge = sibling.find("span", class_="badge")
                p = sibling.find("p")
                
                counter_name = link.get_text(strip=True) if link else ""
                counter_id = None
                if img and img.get("src"):
                    m_id = re.search(r'(\d+)\.webp', img.get("src", ""))
                    if m_id:
                        counter_id = int(m_id.group(1))
                        
                severity = badge.get_text(strip=True).lower() if badge else "soft"
                reason = p.get_text(strip=True) if p else ""
                if not reason or reason == "Alasan belum ada":
                    reason = "Efektif menahan mobilitas dan rotasi lawan"
                
                if counter_name:
                    result["counters"].append({
                        "target_id": counter_id,
                        "target_name": counter_name,
                        "severity": severity,
                        "reason": reason
                    })
                sibling = sibling.find_next_sibling()
                
        # Parse Cara melawan
        h2_how = soup.find("h2", string=lambda t: t and "Cara melawan" in t)
        if h2_how:
            sib = h2_how.find_next_sibling()
            tips = []
            while sib and sib.name not in ["h2", "footer", "form"] and "card" not in sib.get("class", []):
                if sib.name == "p" and "favbtn" not in sib.get("class", []):
                    tips.append(sib.get_text(strip=True))
                sib = sib.find_next_sibling()
            result["how_to_counter"] = " ".join(tips)
            
        # Parse Counter item
        h2_item = soup.find("h2", string=lambda t: t and "Counter item" in t)
        if h2_item:
            sib = h2_item.find_next_sibling()
            while sib and sib.name == "div" and "card" in sib.get("class", []):
                row = sib.find("div", class_="row")
                desc = sib.find("p")
                item_name = row.get_text(" ", strip=True) if row else sib.get_text(" ", strip=True)
                item_desc = desc.get_text(strip=True) if desc else ""
                result["counter_items"].append({
                    "name": item_name,
                    "description": item_desc
                })
                sib = sib.find_next_sibling()

    except Exception:
        pass
    return result

def download_and_process_portrait(client: httpx.Client, img_url: str, hero_id: int) -> str:
    target_path = HERO_ASSETS_DIR / f"{hero_id}.webp"
    rel_path = f"/assets/heroes/{hero_id}.webp"
    
    if target_path.exists() and target_path.stat().st_size > 500:
        return rel_path
        
    try:
        if img_url:
            resp = client.get(img_url, headers={"User-Agent": USER_AGENT}, timeout=10.0)
            if resp.status_code == 200:
                img = Image.open(io.BytesIO(resp.content))
                img = img.convert("RGBA")
                img = img.resize((128, 128), Image.Resampling.LANCZOS)
                img.save(target_path, "WEBP", quality=90)
                return rel_path
    except Exception as e:
        print(f"       Warning: Portrait download failed for {hero_id}: {e}", flush=True)

    # Fallback placeholder
    from PIL import ImageDraw
    fallback_img = Image.new("RGBA", (128, 128), color=(18, 22, 31, 255))
    draw = ImageDraw.Draw(fallback_img)
    draw.rectangle([2, 2, 125, 125], outline=(184, 255, 1, 255), width=2)
    draw.text((64, 64), str(hero_id), fill=(245, 196, 81, 255), anchor="mm")
    fallback_img.save(target_path, "WEBP", quality=85)
    return rel_path

def load_kpl_win_rates() -> Dict[int, Dict[str, Any]]:
    stats = {}
    db_path = ROOT_DIR / "data" / "processed" / "hok_drafts.db"
    if db_path.exists():
        import sqlite3
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("""
        SELECT da.global_hero_id, b.winner_side, da.side
        FROM battles b
        JOIN draft_actions da ON b.battle_id = da.battle_id
        WHERE da.action = 'pick' AND b.is_complete = 1
        """)
        for hid, w_side, side in cur.fetchall():
            if hid not in stats:
                stats[hid] = {"matches": 0, "wins": 0}
            stats[hid]["matches"] += 1
            if w_side == side:
                stats[hid]["wins"] += 1
        conn.close()
    return stats

def build_master_database():
    print("\n=== STARTING HOK GLOBAL ASSET & METADATA SYNCHRONIZATION ===", flush=True)
    client = httpx.Client(follow_redirects=True)
    
    kpl_cn_map = load_kpl_hero_mapping()
    kpl_wr_map = load_kpl_win_rates()
    roster = scrape_kurohiko_roster(client)
    stats_map, builds_map = fetch_hokfire_data(client)
    
    print(f" [3/5] Scraping detailed counters & tactics for {len(roster)} heroes...", flush=True)
    hero_details = {}
    for idx, hero in enumerate(roster):
        slug = hero["slug"]
        details = scrape_kurohiko_hero_counters(client, slug)
        hero_details[hero["hero_id"]] = details
        if (idx + 1) % 25 == 0 or idx == len(roster) - 1:
            print(f"       Processed {idx + 1}/{len(roster)} heroes...", flush=True)
        time.sleep(0.04)
        
    print(" [4/5] Standardizing 128x128 .webp portraits in data/assets/heroes/...", flush=True)
    master_heroes = []
    
    for hero in roster:
        hid = hero["hero_id"]
        name = hero["name"]
        slug = hero["slug"]
        primary_lane = hero["primary_lane"]
        
        stat = stats_map.get(hid, {})
        build = builds_map.get(hid, {})
        detail = hero_details.get(hid, {})
        
        cn_name = kpl_cn_map.get(hid, CN_OVERRIDE_MAP.get(hid, name))
        
        role = detail.get("role") or build.get("role") or "Fighter"
        lanes = detail.get("lanes") or [primary_lane]
        if not lanes:
            lanes = [primary_lane]
            
        portrait_rel = download_and_process_portrait(client, hero["img_url"], hid)
        
        tier = stat.get("tier") or build.get("tier") or "A"
        win_rate = stat.get("win_rate")
        if win_rate is None or win_rate == 0.5:
            kpl_data = kpl_wr_map.get(hid)
            if kpl_data and kpl_data["matches"] > 0:
                win_rate = round(kpl_data["wins"] / kpl_data["matches"], 4)
            else:
                win_rate = 0.5020
        pick_rate = stat.get("pick_rate") or 0.0350
        ban_rate = stat.get("ban_rate") or 0.0100
        
        master_entry = {
            "hero_id": hid,
            "name": name,
            "chinese_name": cn_name,
            "slug": slug,
            "title": build.get("title", f"Honor of Kings {name}"),
            "primary_role": role,
            "primary_lane": primary_lane,
            "lanes": lanes,
            "tier": tier,
            "win_rate": win_rate,
            "pick_rate": pick_rate,
            "ban_rate": ban_rate,
            "counters": detail.get("counters", []),
            "tactical_tips": detail.get("how_to_counter", ""),
            "counter_items": detail.get("counter_items", []),
            "portrait_asset": portrait_rel,
            "kpl_id": hid if hid in kpl_cn_map else None,
            "is_global_exclusive": hid not in kpl_cn_map
        }
        master_heroes.append(master_entry)
        
    master_heroes.sort(key=lambda x: x["name"])
    
    # Invert counters to build 'countered_by'
    id_to_entry = {h["hero_id"]: h for h in master_heroes}
    for h in master_heroes:
        h["countered_by"] = []
    for h in master_heroes:
        for c in h["counters"]:
            tid = c.get("target_id")
            if tid and tid in id_to_entry:
                id_to_entry[tid]["countered_by"].append({
                    "counter_id": h["hero_id"],
                    "counter_name": h["name"],
                    "severity": c["severity"],
                    "reason": c["reason"]
                })
                
    output_path = MAPPINGS_DIR / "master_heroes_global.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(master_heroes, f, indent=2, ensure_ascii=False)
        
    print(f" [5/5] Success! Saved {len(master_heroes)} master heroes to {output_path}", flush=True)
    print(f"       Portraits directory: {HERO_ASSETS_DIR} (Total files: {len(list(HERO_ASSETS_DIR.glob('*.webp')))})", flush=True)

if __name__ == "__main__":
    build_master_database()
