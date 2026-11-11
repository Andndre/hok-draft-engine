"""1_ingest_kpl.py
Ingests professional tournament matches and Ban/Pick sequences from kpl-bp-dataset.
- Bridges KPL Chinese hero IDs and names to 120 Global Hero IDs
- Tracks Fearless Draft / Global BP constraints across series (Bo3, Bo5, Bo7)
- Stores normalized draft states and match records into SQLite: data/processed/hok_drafts.db
"""

import os
import csv
import json
import sqlite3
from pathlib import Path
from typing import Dict, Any, List, Set

ROOT_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT_DIR / "data" / "raw" / "kpl-bp-dataset" / "data"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
DB_PATH = PROCESSED_DIR / "hok_drafts.db"

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

def load_global_mapping() -> Dict[int, int]:
    """Returns mapping from KPL hero_id to Global hero_id"""
    mapping = {}
    if MAPPINGS_FILE.exists():
        with open(MAPPINGS_FILE, "r", encoding="utf-8") as f:
            heroes = json.load(f)
            for h in heroes:
                hid = h["hero_id"]
                # Most IDs map directly
                mapping[hid] = hid
                if h.get("kpl_id"):
                    mapping[h["kpl_id"]] = hid
    return mapping

def init_db(conn: sqlite3.Connection):
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        league_id TEXT,
        league TEXT,
        year INTEGER,
        date TEXT,
        stage TEXT,
        bo INTEGER,
        team_blue TEXT,
        team_red TEXT,
        winner TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS battles (
        battle_id TEXT PRIMARY KEY,
        match_id TEXT,
        game_no INTEGER,
        winner_side TEXT,
        duration_sec INTEGER,
        first_pick_side TEXT,
        is_complete INTEGER,
        FOREIGN KEY(match_id) REFERENCES matches(match_id)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS draft_actions (
        battle_id TEXT,
        ord INTEGER,
        camp INTEGER,
        side TEXT,
        action TEXT,
        hero_id INTEGER,
        global_hero_id INTEGER,
        hero_cn TEXT,
        pos INTEGER,
        PRIMARY KEY (battle_id, ord)
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS fearless_states (
        battle_id TEXT,
        game_no INTEGER,
        blue_unavailable TEXT, -- JSON array of hero IDs
        red_unavailable TEXT,  -- JSON array of hero IDs
        PRIMARY KEY (battle_id)
    )
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_actions_battle ON draft_actions(battle_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_battles_match ON battles(match_id)")
    conn.commit()

def ingest_kpl_data():
    print("\n=== STARTING KPL TOURNAMENT DATASET INGESTION ===")
    global_map = load_global_mapping()
    print(f" Loaded {len(global_map)} hero mapping rules.")

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    cursor = conn.cursor()

    battles_csv = RAW_DIR / "battles.csv"
    draft_actions_csv = RAW_DIR / "draft-actions.csv"

    if not battles_csv.exists() or not draft_actions_csv.exists():
        raise SystemExit(
            f"Error: {battles_csv} or {draft_actions_csv} not found. "
            "Initialize the KPL dataset submodule with 'git submodule update --init --depth 1' "
            "or run 'uv run ../../scripts/setup.py --data-only'."
        )

    # Ingest battles & match metadata
    print(f" [1/3] Parsing battles metadata from {battles_csv}...")
    battle_records = []
    match_records = {}
    
    with open(battles_csv, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            b_id = row["battle_id"]
            m_id = row["match_id"]
            g_no = int(row["game_no"]) if row.get("game_no") else 1
            w_side = row.get("winner_side", "")
            dur = int(row["duration_sec"]) if row.get("duration_sec") else 0
            fp_side = row.get("first_pick_side", "blue")
            comp = int(row.get("complete", 1))

            battle_records.append((b_id, m_id, g_no, w_side, dur, fp_side, comp))

            if m_id not in match_records:
                match_records[m_id] = (
                    m_id,
                    row.get("league_id", ""),
                    row.get("league", ""),
                    int(row.get("year", 2026)),
                    row.get("date", ""),
                    row.get("stage", ""),
                    int(row.get("bo", 5)),
                    row.get("team_blue", ""),
                    row.get("team_red", ""),
                    row.get("team_blue", "") if w_side == "blue" else row.get("team_red", "")
                )

    cursor.executemany("""
    INSERT OR REPLACE INTO matches (match_id, league_id, league, year, date, stage, bo, team_blue, team_red, winner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, list(match_records.values()))

    cursor.executemany("""
    INSERT OR REPLACE INTO battles (battle_id, match_id, game_no, winner_side, duration_sec, first_pick_side, is_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, battle_records)

    conn.commit()
    print(f"       Ingested {len(match_records)} matches and {len(battle_records)} battles.")

    # Ingest draft actions
    print(f" [2/3] Parsing Ban/Pick sequences from {draft_actions_csv}...")
    action_records = []
    with open(draft_actions_csv, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            b_id = row["battle_id"]
            ord_id = int(row["ord"])
            camp = int(row["camp"])
            side = row["side"]
            action = row["action"]
            hero_cn = row["hero"]
            hero_id = int(row["hero_id"])
            pos = int(row["pos"]) if row.get("pos") else 0
            
            global_id = global_map.get(hero_id, hero_id)

            action_records.append((b_id, ord_id, camp, side, action, hero_id, global_id, hero_cn, pos))

    cursor.executemany("""
    INSERT OR REPLACE INTO draft_actions (battle_id, ord, camp, side, action, hero_id, global_hero_id, hero_cn, pos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, action_records)
    conn.commit()
    print(f"       Ingested {len(action_records)} draft actions.")

    # [3/3] Track Fearless Draft (Global BP) across matches
    print(" [3/3] Computing Fearless Draft (Global BP) series tracking...")
    # Group battles by match_id and order by game_no
    cursor.execute("""
    SELECT battle_id, match_id, game_no FROM battles ORDER BY match_id, game_no ASC
    """)
    battles_ordered = cursor.fetchall()
    
    # Pre-fetch all picks grouped by battle_id
    cursor.execute("""
    SELECT battle_id, side, global_hero_id FROM draft_actions WHERE action = 'pick'
    """)
    picks_by_battle = {}
    for b_id, side, g_id in cursor.fetchall():
        if b_id not in picks_by_battle:
            picks_by_battle[b_id] = {"blue": set(), "red": set()}
        picks_by_battle[b_id][side].add(g_id)

    fearless_rows = []
    current_match = None
    accumulated_blue = set()
    accumulated_red = set()

    for b_id, m_id, g_no in battles_ordered:
        if m_id != current_match:
            current_match = m_id
            accumulated_blue = set()
            accumulated_red = set()

        # At the start of this battle, unavailable heroes are what was used in previous games
        fearless_rows.append((
            b_id,
            g_no,
            json.dumps(sorted(list(accumulated_blue))),
            json.dumps(sorted(list(accumulated_red)))
        ))

        # Add this battle's picks for subsequent games in the series
        battle_picks = picks_by_battle.get(b_id, {"blue": set(), "red": set()})
        accumulated_blue.update(battle_picks["blue"])
        accumulated_red.update(battle_picks["red"])

    cursor.executemany("""
    INSERT OR REPLACE INTO fearless_states (battle_id, game_no, blue_unavailable, red_unavailable)
    VALUES (?, ?, ?, ?)
    """, fearless_rows)

    conn.commit()
    conn.close()

    print(f" Successfully completed KPL data ingestion into {DB_PATH}")

if __name__ == "__main__":
    ingest_kpl_data()
