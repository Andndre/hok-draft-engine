"""extract_kpl_synergy.py
Extracts empirical tournament synergy pairs, win rates, counter matchups,
Phase 1 First-Pick (B1/R1) openers + Pre-Ban patterns, and Phase 2 Counter/Combo-Denial Bans
from 11,141 matches in hok_drafts.db (filtered strictly to the 120 Global Heroes)
and exports to kpl_synergy_matrix.json.
"""

import sqlite3
import json
from collections import defaultdict
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / "data" / "processed" / "hok_drafts.db"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
OUTPUT_FILE = ROOT_DIR / "data" / "mappings" / "kpl_synergy_matrix.json"
WEB_OUTPUT_FILE = ROOT_DIR / "apps" / "web" / "public" / "kpl_synergy_matrix.json"
DIST_OUTPUT_FILE = ROOT_DIR / "apps" / "web" / "dist" / "kpl_synergy_matrix.json"

def normalize_hid(hid: int) -> int:
    # Map Zhu Bajie (511) to Global equivalent Ata (556)
    if hid == 511:
        return 556
    return hid

def extract_synergy():
    master = json.load(open(MAPPINGS_FILE, encoding="utf-8"))
    valid_ids = {h["hero_id"] for h in master}
    id_to_name = {h["hero_id"]: h["name"] for h in master}

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
    SELECT b.battle_id, b.winner_side, da.ord, da.side, da.action, da.global_hero_id
    FROM battles b
    JOIN draft_actions da ON b.battle_id = da.battle_id
    WHERE b.is_complete = 1
    ORDER BY b.battle_id, da.ord ASC
    """)

    battles_actions = defaultdict(list)
    battle_winners = {}
    for b_id, winner_side, ord_id, side, action, raw_hid in cursor.fetchall():
        hid = normalize_hid(raw_hid)
        if hid in valid_ids:
            battles_actions[b_id].append((ord_id, side, action, hid))
            battle_winners[b_id] = winner_side

    conn.close()

    pair_games = defaultdict(int)
    pair_wins = defaultdict(int)

    head_to_head_games = defaultdict(int)
    head_to_head_wins = defaultdict(int)

    combo_vs_enemy_games = defaultdict(int)
    combo_vs_enemy_wins = defaultdict(int)

    # Tournament Phase-Specific Statistics
    b1_picks = defaultdict(int)
    b1_wins = defaultdict(int)
    r1_r2_picks = defaultdict(int)
    r1_r2_wins = defaultdict(int)
    p1_bans_total = defaultdict(int)

    # Pre-ban patterns in Phase 1 (ord <= 4) before picking a B1 hero (ord 5)
    blue_preban_for_b1 = defaultdict(lambda: defaultdict(int))
    # Phase 2 bans (ord >= 11) given enemy Phase 1 picks (ord 5..10)
    p2_ban_vs_enemy = defaultdict(lambda: defaultdict(int))
    # Phase 2 bans (ord >= 11) given our own Phase 1 picks (ord 5..10)
    p2_ban_protect_our = defaultdict(lambda: defaultdict(int))

    for b_id, actions in battles_actions.items():
        w_side = battle_winners[b_id]

        blue_picks = [hid for o, s, a, hid in actions if a == "pick" and s == "blue"]
        red_picks = [hid for o, s, a, hid in actions if a == "pick" and s == "red"]

        blue_p1_bans = [hid for o, s, a, hid in actions if o <= 4 and a == "ban" and s == "blue"]
        red_p1_bans = [hid for o, s, a, hid in actions if o <= 4 and a == "ban" and s == "red"]
        blue_p1_picks = [hid for o, s, a, hid in actions if 5 <= o <= 10 and a == "pick" and s == "blue"]
        red_p1_picks = [hid for o, s, a, hid in actions if 5 <= o <= 10 and a == "pick" and s == "red"]

        for hid in blue_p1_bans + red_p1_bans:
            p1_bans_total[hid] += 1

        if blue_p1_picks:
            b1 = blue_p1_picks[0]
            b1_picks[b1] += 1
            if w_side == "blue":
                b1_wins[b1] += 1
            for b_ban in blue_p1_bans:
                blue_preban_for_b1[b1][b_ban] += 1

        for rp in red_p1_picks[:2]:
            r1_r2_picks[rp] += 1
            if w_side == "red":
                r1_r2_wins[rp] += 1

        for o, s, a, hid in actions:
            if o >= 11 and a == "ban":
                enemy_p1 = red_p1_picks if s == "blue" else blue_p1_picks
                our_p1 = blue_p1_picks if s == "blue" else red_p1_picks
                for ep in enemy_p1:
                    p2_ban_vs_enemy[ep][hid] += 1
                for op in our_p1:
                    p2_ban_protect_our[op][hid] += 1

        # Pair synergy & head-to-head
        for our_side, our_p, enemy_p in [("blue", blue_picks, red_picks), ("red", red_picks, blue_picks)]:
            won = (w_side == our_side)
            for i in range(len(our_p)):
                for j in range(i + 1, len(our_p)):
                    p1, p2 = min(our_p[i], our_p[j]), max(our_p[i], our_p[j])
                    pair_games[(p1, p2)] += 1
                    if won:
                        pair_wins[(p1, p2)] += 1
                    for e in enemy_p:
                        combo_vs_enemy_games[(p1, p2, e)] += 1
                        if won:
                            combo_vs_enemy_wins[(p1, p2, e)] += 1

            for o in our_p:
                for e in enemy_p:
                    head_to_head_games[(o, e)] += 1
                    if won:
                        head_to_head_wins[(o, e)] += 1

    # 1. Significant pro pairs (>= 12 matches together, both in Global 120)
    top_pairs = {}
    for (p1, p2), total in pair_games.items():
        if total >= 12 and p1 != p2:
            wr = round(pair_wins[(p1, p2)] / total, 3)
            top_pairs[f"{p1}_{p2}"] = {
                "hero1": p1,
                "hero2": p2,
                "hero1_name": id_to_name[p1],
                "hero2_name": id_to_name[p2],
                "matches": total,
                "win_rate": wr,
                "synergy_lift": round(wr - 0.50, 3)
            }

    # 2. First-Pick (B1 / R1-R2) Openers & Pre-Ban Matrix
    b1_opener_stats = {}
    for hid in valid_ids:
        b1_cnt = b1_picks[hid]
        r1_cnt = r1_r2_picks[hid]
        p1_ban_cnt = p1_bans_total[hid]
        if b1_cnt >= 10 or r1_cnt >= 15 or p1_ban_cnt >= 30:
            b1_wr = round(b1_wins[hid] / b1_cnt, 3) if b1_cnt > 0 else 0.50
            top_prebans = sorted(blue_preban_for_b1[hid].items(), key=lambda x: x[1], reverse=True)[:6]
            b1_opener_stats[str(hid)] = {
                "hero_id": hid,
                "hero_name": id_to_name[hid],
                "b1_picks": b1_cnt,
                "b1_win_rate": b1_wr,
                "r1_r2_picks": r1_cnt,
                "p1_bans": p1_ban_cnt,
                "top_prebans": [
                    {"ban_id": b_id, "ban_name": id_to_name[b_id], "count": cnt}
                    for b_id, cnt in top_prebans if cnt >= 5
                ]
            }

    # 3. Phase 2 Ban Matrix (Enemy Pick -> Best Phase 2 Bans)
    phase2_ban_matrix = {}
    for ep_hid, ban_dict in p2_ban_vs_enemy.items():
        top_b2 = sorted(ban_dict.items(), key=lambda x: x[1], reverse=True)[:10]
        filtered_b2 = [
            {"ban_id": b_id, "ban_name": id_to_name[b_id], "count": cnt}
            for b_id, cnt in top_b2 if cnt >= 8 and b_id != ep_hid
        ]
        if filtered_b2:
            phase2_ban_matrix[str(ep_hid)] = filtered_b2

    # 4. Phase 2 Protect Matrix (Our Pick -> Best Phase 2 Protective Bans)
    phase2_protect_matrix = {}
    for op_hid, ban_dict in p2_ban_protect_our.items():
        top_b2 = sorted(ban_dict.items(), key=lambda x: x[1], reverse=True)[:8]
        filtered_b2 = [
            {"ban_id": b_id, "ban_name": id_to_name[b_id], "count": cnt}
            for b_id, cnt in top_b2 if cnt >= 8 and b_id != op_hid
        ]
        if filtered_b2:
            phase2_protect_matrix[str(op_hid)] = filtered_b2

    # 5. Dunshan (509) specific counters
    dunshan_counters = {}
    for (o, e), total in head_to_head_games.items():
        if e == 509 and total >= 12:
            wr = round(head_to_head_wins[(o, e)] / total, 3)
            dunshan_counters[str(o)] = {
                "hero_id": o,
                "hero_name": id_to_name[o],
                "matches_vs_dunshan": total,
                "win_rate_vs_dunshan": wr
            }

    dunshan_pair_counters = {}
    for (p1, p2, e), total in combo_vs_enemy_games.items():
        if e == 509 and total >= 5 and p1 != p2:
            wr = round(combo_vs_enemy_wins[(p1, p2, e)] / total, 3)
            if wr >= 0.54:
                dunshan_pair_counters[f"{p1}_{p2}"] = {
                    "hero1": p1,
                    "hero2": p2,
                    "hero1_name": id_to_name[p1],
                    "hero2_name": id_to_name[p2],
                    "matches_vs_dunshan": total,
                    "win_rate_vs_dunshan": wr
                }

    export_data = {
        "source": "KPL & KIC Pro Tournament Ban/Pick Dataset (11,141 matches, Global 120 Filtered)",
        "total_pro_pairs": len(top_pairs),
        "pairs": top_pairs,
        "b1_openers": b1_opener_stats,
        "phase2_ban_vs_enemy": phase2_ban_matrix,
        "phase2_ban_protect_our": phase2_protect_matrix,
        "dunshan_counters": dunshan_counters,
        "dunshan_pair_counters": dunshan_pair_counters
    }

    for out_path in [OUTPUT_FILE, WEB_OUTPUT_FILE, DIST_OUTPUT_FILE]:
        if out_path.parent.exists():
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False)

    print(f"Exported {len(top_pairs)} Global pairs, {len(b1_opener_stats)} B1 openers, and {len(phase2_ban_matrix)} Phase 2 ban rules.")

if __name__ == "__main__":
    extract_synergy()
