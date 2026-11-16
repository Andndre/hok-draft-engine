"""extract_kpl_matchups.py
Build a MEASURED hero-vs-hero matchup table from the KPL tournament database.

Semantic (this is the whole point):
    delta(x, y) = winrate(x | y is on the OPPOSING team)
                - winrate(x | y is ABSENT from the entire draft)

    delta > 0  => x has the favorable matchup against y (x beats y)
    delta < 0  => y has the favorable matchup (y beats x)

The baseline is deliberately "y absent from the entire draft". Using "y on x's own
team" as baseline would fold pair synergy into the comparison and bias every pair
negative, which is exactly the mistake this lane exists to avoid.

Recency weighting matches extract_kpl_synergy.py: half-life 365.25 days.

Output: data/mappings/hero_measured_matchups.json
"""

import json
import math
import sqlite3
import time
from datetime import datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / "data" / "processed" / "hok_drafts.db"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
OUTPUT_FILE = ROOT_DIR / "data" / "mappings" / "hero_measured_matchups.json"

MODEL = "kpl-measured-matchup-v1"
HALF_LIFE_DAYS = 365.25
MIN_SAMPLE = 30
MIN_SIDE_SAMPLE = 10
EFFECT_THRESHOLD = 0.02
MAX_ENTRIES = 8
SIDES = ("blue", "red")
ALIAS_INACTIVE = 511


def _empty_bucket():
    # [games, wins, weighted_games, weighted_wins]
    return [0, 0, 0.0, 0.0]


def _win_rate(bucket):
    games, wins = bucket[0], bucket[1]
    return wins / games if games else 0.0


def load_universe():
    master = json.loads(MAPPINGS_FILE.read_text(encoding="utf-8"))
    id_to_name = {}
    for hero in master:
        hero_id = int(hero["hero_id"])
        if hero_id == ALIAS_INACTIVE:
            continue
        id_to_name[hero_id] = hero["name"]
    return id_to_name


def load_battles(cursor, universe):
    """Return {battle_id: {winner_side, date, blue, red}} for complete battles in the universe."""
    cursor.execute(
        """
        SELECT b.battle_id, b.winner_side, m.date, da.side, da.global_hero_id
        FROM battles b
        JOIN draft_actions da ON b.battle_id = da.battle_id
        JOIN matches m ON b.match_id = m.match_id
        WHERE b.is_complete = 1
          AND da.action = 'pick'
          AND da.global_hero_id IS NOT NULL
        ORDER BY b.battle_id, da.ord ASC
        """
    )
    sides = {}
    for battle_id, winner_side, date, side, raw_hid in cursor.fetchall():
        hero_id = int(raw_hid)
        if hero_id not in universe:
            continue
        entry = sides.get(battle_id)
        if entry is None:
            entry = sides[battle_id] = {"winner_side": winner_side, "date": date, "blue": [], "red": []}
        if side in SIDES:
            entry[side].append(hero_id)
    return sides


def measured_pair_deltas(universe, side_totals, vs_opponent, same_side):
    """Compute the ordered-pair delta table: {(x, y): record}, y being the opposing hero.

    delta(x, y) = winrate(x | y on the OPPOSING team) - winrate(x | y ABSENT from the draft).

    The absent baseline is obtained by exact decomposition instead of rescanning battles:
        B(x, y, s) = T(x, s) - A(x, y, s) - S(x, y, s)
    T = all picks of x on side s, A = y picked by the opposing side, S = y picked on x's
    own side. B is therefore "x on side s and y nowhere in that draft", which is the
    baseline the semantic requires (an own-team baseline would fold synergy in).
    """
    ordered = sorted(universe)
    pairs = {}
    for hero in ordered:
        totals_by_side = {side: side_totals.get((hero, side)) for side in SIDES}
        if not any(totals_by_side.values()):
            continue
        for opponent in ordered:
            if opponent == hero:
                continue
            delta_numerator = 0.0
            weighted_numerator = 0.0
            n = 0
            weighted_n = 0.0
            eligible_sides = 0
            for side in SIDES:
                total = totals_by_side[side]
                if total is None:
                    continue
                a = vs_opponent.get((hero, opponent, side))
                a_games = a[0] if a else 0
                if a_games < MIN_SIDE_SAMPLE:
                    continue
                s = same_side.get((min(hero, opponent), max(hero, opponent), side))
                s_games = s[0] if s else 0
                b_games = total[0] - a_games - s_games
                if b_games < MIN_SIDE_SAMPLE:
                    continue
                b_wins = total[1] - a[1] - (s[1] if s else 0)
                b_weighted_games = total[2] - a[2] - (s[2] if s else 0)
                b_weighted_wins = total[3] - a[3] - (s[3] if s else 0)
                delta_side = a[1] / a_games - b_wins / b_games
                a_weighted = a[2]
                if a_weighted > 0 and b_weighted_games > 0:
                    weighted_delta_side = a[3] / a_weighted - b_weighted_wins / b_weighted_games
                else:
                    weighted_delta_side = delta_side
                delta_numerator += a_games * delta_side
                weighted_numerator += a_weighted * weighted_delta_side
                n += a_games
                weighted_n += a_weighted
                eligible_sides += 1
            if eligible_sides == 0 or n < MIN_SAMPLE:
                continue
            delta = delta_numerator / n
            weighted_delta = weighted_numerator / weighted_n if weighted_n > 0 else delta
            pairs[(hero, opponent)] = {
                "hero_id": opponent,
                "delta": round(delta, 4),
                "weighted_delta": round(weighted_delta, 4),
                "n": n,
                "n_eff": round(weighted_n, 2),
            }
    return pairs


def extract_measured_matchups(db_path=DB_PATH):
    started = time.perf_counter()
    universe = load_universe()

    connection = sqlite3.connect(db_path)
    try:
        battles = load_battles(connection.cursor(), universe)
    finally:
        connection.close()

    # Date weights relative to the newest battle used.
    max_date_str = max((entry["date"] for entry in battles.values()), default=None)
    max_date = datetime.strptime(max_date_str, "%Y-%m-%d")
    weights = {}
    for battle_id, entry in battles.items():
        try:
            battle_date = datetime.strptime(entry["date"], "%Y-%m-%d")
            age_days = max(0, (max_date - battle_date).days)
        except (TypeError, ValueError):
            age_days = 365
        weights[battle_id] = math.exp(-(math.log(2) * age_days) / HALF_LIFE_DAYS)

    # A: x picked on `side`, y picked by the OPPOSING side.
    # S: x and y picked on the SAME side (needed to subtract from the absent baseline).
    # T: all observations of x on `side` (the pool the absent baseline is carved out of).
    vs_opponent = {}
    same_side = {}
    side_totals = {}
    hero_totals = {}

    for battle_id, entry in battles.items():
        winner = entry["winner_side"]
        weight = weights[battle_id]
        blue = entry["blue"]
        red = entry["red"]
        for side in SIDES:
            own = blue if side == "blue" else red
            enemy = red if side == "blue" else blue
            won = 1 if winner == side else 0
            for hero in own:
                total = side_totals.setdefault((hero, side), _empty_bucket())
                total[0] += 1
                total[1] += won
                total[2] += weight
                total[3] += weight * won
                hero_total = hero_totals.setdefault(hero, _empty_bucket())
                hero_total[0] += 1
                hero_total[1] += won
                hero_total[2] += weight
                hero_total[3] += weight * won
                for opponent in enemy:
                    bucket = vs_opponent.setdefault((hero, opponent, side), _empty_bucket())
                    bucket[0] += 1
                    bucket[1] += won
                    bucket[2] += weight
                    bucket[3] += weight * won
            for i in range(len(own)):
                for j in range(i + 1, len(own)):
                    low, high = sorted((own[i], own[j]))
                    if low == high:
                        continue
                    bucket = same_side.setdefault((low, high, side), _empty_bucket())
                    bucket[0] += 1
                    bucket[1] += won
                    bucket[2] += weight
                    bucket[3] += weight * won

    pairs = measured_pair_deltas(universe, side_totals, vs_opponent, same_side)

    hero_entries = {}
    for hero in sorted(universe):
        counters = []
        countered_by = []
        for opponent in sorted(universe):
            record = pairs.get((hero, opponent))
            if record is None:
                continue
            if record["delta"] >= EFFECT_THRESHOLD:
                counters.append(record)
            elif record["delta"] <= -EFFECT_THRESHOLD:
                countered_by.append(record)

        counters.sort(key=lambda row: (-row["delta"], row["hero_id"]))
        countered_by.sort(key=lambda row: (row["delta"], row["hero_id"]))
        if not counters and not countered_by:
            continue

        totals = hero_totals.get(hero, _empty_bucket())
        hero_entries[str(hero)] = {
            "measured_counters": [
                {
                    "target_id": row["hero_id"],
                    "target_name": universe[row["hero_id"]],
                    "delta": row["delta"],
                    "weighted_delta": row["weighted_delta"],
                    "n": row["n"],
                    "n_eff": row["n_eff"],
                }
                for row in counters[:MAX_ENTRIES]
            ],
            "measured_countered_by": [
                {
                    "counter_id": row["hero_id"],
                    "counter_name": universe[row["hero_id"]],
                    "delta": row["delta"],
                    "weighted_delta": row["weighted_delta"],
                    "n": row["n"],
                    "n_eff": row["n_eff"],
                }
                for row in countered_by[:MAX_ENTRIES]
            ],
            "measured_meta": {
                "measured_model": MODEL,
                "measured_as_of": max_date_str,
                "measured_games": totals[0],
                "measured_win_rate": round(_win_rate(totals), 4),
                "measured_pairs_emitted": len(counters) + len(countered_by),
            },
        }

    payload = {
        "model": MODEL,
        "generated_at": max_date_str,
        "source": "kpl-bp-dataset",
        "half_life_days": HALF_LIFE_DAYS,
        "min_sample": MIN_SAMPLE,
        "min_side_sample": MIN_SIDE_SAMPLE,
        "as_of": max_date_str,
        "battles_count": len(battles),
        "heroes": hero_entries,
    }
    return payload, time.perf_counter() - started


def main():
    payload, elapsed = extract_measured_matchups()
    OUTPUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    heroes = payload["heroes"]
    pairs = sum(len(entry["measured_counters"]) + len(entry["measured_countered_by"]) for entry in heroes.values())
    print(
        f"Wrote {OUTPUT_FILE.name}: {len(heroes)} heroes with measured pairs, "
        f"{pairs} emitted matchup entries from {payload['battles_count']} battles "
        f"(as_of {payload['as_of']}) in {elapsed:.2f}s"
    )


if __name__ == "__main__":
    main()
