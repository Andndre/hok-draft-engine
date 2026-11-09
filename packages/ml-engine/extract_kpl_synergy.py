"""extract_kpl_synergy.py
Extracts empirical tournament synergy pairs, win rates, and counter matchups
from 11,141 matches in hok_drafts.db and exports to kpl_synergy_matrix.json.
"""

import sqlite3
import json
from collections import defaultdict
from pathlib import Path

ROOT_DIR = Path("D:/hok-draft-engine")
DB_PATH = ROOT_DIR / "data" / "processed" / "hok_drafts.db"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
OUTPUT_FILE = ROOT_DIR / "data" / "mappings" / "kpl_synergy_matrix.json"
WEB_OUTPUT_FILE = ROOT_DIR / "apps" / "web" / "public" / "kpl_synergy_matrix.json"

def extract_synergy():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
    SELECT b.battle_id, b.winner_side, da.side, da.global_hero_id
    FROM battles b
    JOIN draft_actions da ON b.battle_id = da.battle_id
    WHERE da.action = 'pick' AND b.is_complete = 1
    """)

    battles = defaultdict(lambda: {"blue": [], "red": [], "winner": ""})
    for b_id, winner_side, side, hid in cursor.fetchall():
        battles[b_id][side].append(hid)
        battles[b_id]["winner"] = winner_side

    conn.close()

    pair_games = defaultdict(int)
    pair_wins = defaultdict(int)

    # Against specific enemy heroes (counter matrix)
    head_to_head_games = defaultdict(int) # (our_hero, enemy_hero) -> games
    head_to_head_wins = defaultdict(int)

    # Pair vs enemy hero (combo counter matrix)
    combo_vs_enemy_games = defaultdict(int) # ((p1, p2), enemy_hero) -> games
    combo_vs_enemy_wins = defaultdict(int)

    for b_id, data in battles.items():
        for our_side, enemy_side in [("blue", "red"), ("red", "blue")]:
            our_picks = data[our_side]
            enemy_picks = data[enemy_side]
            won = (data["winner"] == our_side)

            # Pair synergy
            for i in range(len(our_picks)):
                for j in range(i + 1, len(our_picks)):
                    p1, p2 = min(our_picks[i], our_picks[j]), max(our_picks[i], our_picks[j])
                    pair_games[(p1, p2)] += 1
                    if won:
                        pair_wins[(p1, p2)] += 1

                    # Combo vs enemy hero
                    for e in enemy_picks:
                        combo_vs_enemy_games[(p1, p2, e)] += 1
                        if won:
                            combo_vs_enemy_wins[(p1, p2, e)] += 1

            # Head to head
            for o in our_picks:
                for e in enemy_picks:
                    head_to_head_games[(o, e)] += 1
                    if won:
                        head_to_head_wins[(o, e)] += 1

    # Load master hero list
    master = json.load(open(MAPPINGS_FILE, encoding="utf-8"))
    id_to_name = {h["hero_id"]: h["name"] for h in master}

    # Filter significant pro pairs (>= 15 matches together)
    top_pairs = {}
    for (p1, p2), total in pair_games.items():
        if total >= 15:
            wr = round(pair_wins[(p1, p2)] / total, 3)
            # Store in key string "p1_p2"
            top_pairs[f"{p1}_{p2}"] = {
                "hero1": p1,
                "hero2": p2,
                "hero1_name": id_to_name.get(p1, str(p1)),
                "hero2_name": id_to_name.get(p2, str(p2)),
                "matches": total,
                "win_rate": wr,
                "synergy_lift": round(wr - 0.50, 3)
            }

    # Top counters against notable meta defenders (e.g. Dunshan 509)
    dunshan_counters = {}
    for (o, e), total in head_to_head_games.items():
        if e == 509 and total >= 15:
            wr = round(head_to_head_wins[(o, e)] / total, 3)
            dunshan_counters[str(o)] = {
                "hero_id": o,
                "hero_name": id_to_name.get(o, str(o)),
                "matches_vs_dunshan": total,
                "win_rate_vs_dunshan": wr
            }

    # Top combo pairs against Dunshan (509)
    dunshan_pair_counters = {}
    for (p1, p2, e), total in combo_vs_enemy_games.items():
        if e == 509 and total >= 5:
            wr = round(combo_vs_enemy_wins[(p1, p2, e)] / total, 3)
            if wr >= 0.55:
                dunshan_pair_counters[f"{p1}_{p2}"] = {
                    "hero1": p1,
                    "hero2": p2,
                    "hero1_name": id_to_name.get(p1, str(p1)),
                    "hero2_name": id_to_name.get(p2, str(p2)),
                    "matches_vs_dunshan": total,
                    "win_rate_vs_dunshan": wr
                }

    export_data = {
        "source": "KPL & KIC Pro Tournament Ban/Pick Dataset (11,141 matches)",
        "total_pro_pairs": len(top_pairs),
        "pairs": top_pairs,
        "dunshan_counters": dunshan_counters,
        "dunshan_pair_counters": dunshan_pair_counters
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False)

    with open(WEB_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False)

    print(f"Successfully exported {len(top_pairs)} empirical pro pairs to {OUTPUT_FILE}")

if __name__ == "__main__":
    extract_synergy()
