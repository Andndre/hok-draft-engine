import sqlite3
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = BASE_DIR / "data" / "processed" / "hok_drafts.db"
HERO_META_PATH = BASE_DIR / "apps" / "web" / "public" / "hero_metadata.json"
OUT_MAPPING_PATH = BASE_DIR / "data" / "mappings" / "kpl_counter_matrix.json"
OUT_PUBLIC_PATH = BASE_DIR / "apps" / "web" / "public" / "kpl_counter_matrix.json"
OUT_DIST_PATH = BASE_DIR / "apps" / "web" / "dist" / "kpl_counter_matrix.json"

def main():
    if not DB_PATH.exists():
        raise SystemExit(
            f"Error: {DB_PATH} not found. Run 'uv run 1_ingest_kpl.py' "
            "or 'uv run ../../scripts/setup.py --data-only' first."
        )
    print(f"Connecting to KPL database: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Load hero metadata for quick name and avatar lookup
    with open(HERO_META_PATH, "r", encoding="utf-8") as f:
        heroes = json.load(f)
    
    meta_by_id = {h["hero_id"]: h for h in heroes}
    print(f"Loaded {len(heroes)} heroes from metadata.")

    # 1. Total Picks & Bans per Hero in KPL
    cursor.execute("""
        SELECT hero_id, action, COUNT(*) 
        FROM draft_actions 
        GROUP BY hero_id, action
    """)
    stats_raw = cursor.fetchall()
    
    hero_stats = {}
    for hid, action, count in stats_raw:
        if hid not in hero_stats:
            hero_stats[hid] = {"picks": 0, "bans": 0, "wins": 0}
        if action == "pick":
            hero_stats[hid]["picks"] = count
        elif action == "ban":
            hero_stats[hid]["bans"] = count

    # 2. Extract all battles and picks
    print("Extracting battles and head-to-head records...")
    cursor.execute("""
        SELECT b.battle_id, b.winner_side, p.side, p.hero_id
        FROM battles b
        JOIN draft_actions p ON b.battle_id = p.battle_id
        WHERE p.action = 'pick'
    """)
    rows = cursor.fetchall()
    
    battles = {}
    for bid, win_side, side, hid in rows:
        if bid not in battles:
            battles[bid] = {"winner": win_side, "blue": set(), "red": set()}
        battles[bid][side].add(hid)

    # Calculate overall wins and head-to-head records
    h2h = {} # h2h[h1][h2] = {"wins": 0, "total": 0}
    
    for b in battles.values():
        winner = b["winner"]
        blue = b["blue"]
        red = b["red"]
        
        # Track overall wins
        if winner == "blue":
            for h in blue:
                if h in hero_stats: hero_stats[h]["wins"] += 1
        elif winner == "red":
            for h in red:
                if h in hero_stats: hero_stats[h]["wins"] += 1

        # Blue vs Red
        for b_hero in blue:
            for r_hero in red:
                # b_hero vs r_hero
                if b_hero not in h2h: h2h[b_hero] = {}
                if r_hero not in h2h[b_hero]: h2h[b_hero][r_hero] = {"wins": 0, "total": 0}
                h2h[b_hero][r_hero]["total"] += 1
                if winner == "blue":
                    h2h[b_hero][r_hero]["wins"] += 1

                # r_hero vs b_hero
                if r_hero not in h2h: h2h[r_hero] = {}
                if b_hero not in h2h[r_hero]: h2h[r_hero][b_hero] = {"wins": 0, "total": 0}
                h2h[r_hero][b_hero]["total"] += 1
                if winner == "red":
                    h2h[r_hero][b_hero]["wins"] += 1

    print(f"Processed {len(battles)} battles across {len(h2h)} heroes.")

    # 3. Build comprehensive KPL Matchup Profiles
    MIN_MATCHES_THRESHOLD = 12 # Minimum sample size for statistical validity in pro play
    kpl_profiles = {}

    for hid, meta in meta_by_id.items():
        st = hero_stats.get(hid, {"picks": 0, "bans": 0, "wins": 0})
        total_picks = st["picks"]
        total_bans = st["bans"]
        total_wins = st["wins"]
        overall_wr = round(total_wins / total_picks, 4) if total_picks > 0 else 0.0

        worst_matchups = [] # opponents that counter hid (hid has low WR against them)
        best_matchups = []  # opponents that hid counters (hid has high WR against them)

        if hid in h2h:
            candidate_opponents = []
            for opp_id, record in h2h[hid].items():
                if record["total"] >= MIN_MATCHES_THRESHOLD:
                    opp_meta = meta_by_id.get(opp_id)
                    opp_name = opp_meta["name"] if opp_meta else f"Hero #{opp_id}"
                    opp_avatar = opp_meta["portrait_asset"] if opp_meta else f"https://hok.kurohiko.id/icons/hero/{opp_id}.webp"
                    wr = record["wins"] / record["total"]
                    
                    candidate_opponents.append({
                        "opponent_id": opp_id,
                        "opponent_name": opp_name,
                        "opponent_avatar": opp_avatar,
                        "hero_winrate": round(wr, 4),
                        "wins": record["wins"],
                        "losses": record["total"] - record["wins"],
                        "total_matches": record["total"]
                    })

            # Sort worst matchups: lowest hero winrate first (< 46% considered strong counter)
            candidate_opponents.sort(key=lambda x: x["hero_winrate"])
            worst_matchups = [c for c in candidate_opponents if c["hero_winrate"] <= 0.46][:6]

            # Sort best matchups: highest hero winrate first (> 54% considered favorable target)
            candidate_opponents.sort(key=lambda x: x["hero_winrate"], reverse=True)
            best_matchups = [c for c in candidate_opponents if c["hero_winrate"] >= 0.54][:6]

        kpl_profiles[str(hid)] = {
            "hero_id": hid,
            "hero_name": meta["name"],
            "total_picks": total_picks,
            "total_bans": total_bans,
            "overall_winrate": overall_wr,
            "worst_matchups": worst_matchups, # Disadvantaged (Counters to this hero)
            "best_matchups": best_matchups     # Favorable (This hero counters them)
        }

    # Save to JSON outputs
    print(f"Writing KPL counter matrix to {OUT_PUBLIC_PATH}...")
    OUT_MAPPING_PATH.parent.mkdir(parents=True, exist_ok=True)
    for out_path in (OUT_MAPPING_PATH, OUT_PUBLIC_PATH, OUT_DIST_PATH):
        if out_path.parent.exists():
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(kpl_profiles, f, indent=2)

    # 4. Enrich hero_metadata.json with direct kpl_matchup object for seamless client UI rendering
    for h in heroes:
        hid_str = str(h["hero_id"])
        if hid_str in kpl_profiles:
            prof = kpl_profiles[hid_str]
            h["kpl_matchup"] = {
                "total_picks": prof["total_picks"],
                "total_bans": prof["total_bans"],
                "overall_winrate": prof["overall_winrate"],
                "worst_matchups": prof["worst_matchups"],
                "best_matchups": prof["best_matchups"]
            }

    dist_meta_path = BASE_DIR / "apps" / "web" / "dist" / "hero_metadata.json"
    for meta_out in (HERO_META_PATH, dist_meta_path, BASE_DIR / "data" / "mappings" / "master_heroes_global.json"):
        if meta_out.parent.exists():
            with open(meta_out, "w", encoding="utf-8") as f:
                json.dump(heroes, f, indent=2)

    print("=== FINISHED KPL COUNTER MATRIX EXTRACTION ===")

if __name__ == "__main__":
    main()
