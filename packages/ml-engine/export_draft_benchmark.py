"""Export chronological KPL holdout positions with priors computed only before cutoff."""
import argparse
from collections import Counter, defaultdict
from itertools import combinations
import json
from pathlib import Path
import sqlite3
from publish_data import MAPPINGS, ROOT

SEQUENCE = [("blue", "ban"), ("red", "ban"), ("blue", "ban"), ("red", "ban"), ("blue", "pick"), ("red", "pick"), ("red", "pick"), ("blue", "pick"), ("blue", "pick"), ("red", "pick"), ("red", "ban"), ("blue", "ban"), ("red", "ban"), ("blue", "ban"), ("red", "pick"), ("blue", "pick"), ("blue", "pick"), ("red", "pick")]


def export(database, cutoff, limit):
    releases = json.loads((MAPPINGS / "hero_release_status.json").read_text(encoding="utf-8"))
    global_ids = {int(key) for key, value in releases.items() if value["released"]}
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    rows = connection.execute("SELECT b.battle_id,m.date,b.winner_side,da.side,da.action,da.global_hero_id FROM battles b JOIN matches m ON m.match_id=b.match_id JOIN draft_actions da ON da.battle_id=b.battle_id WHERE b.is_complete=1 AND m.date <> '' ORDER BY m.date,b.battle_id,da.ord").fetchall()
    connection.close()
    battles = {}
    for battle_id, date, winner, side, action, hero_id in rows:
        if battle_id not in battles:
            battles[battle_id] = {"date": date, "winner": winner, "actions": []}
        battles[battle_id]["actions"].append((side, action, 556 if hero_id == 511 else hero_id))
    pairs = defaultdict(lambda: [0, 0])
    hero_counts, hero_wins = Counter(), Counter()
    openers = defaultdict(lambda: {"b1_picks": 0, "r1_r2_picks": 0, "p1_bans": 0})
    training = 0
    for battle in battles.values():
        if battle["date"] >= cutoff:
            continue
        training += 1
        actions = battle["actions"]
        for side in ("blue", "red"):
            picks = sorted({hero_id for team, kind, hero_id in actions if team == side and kind == "pick" and hero_id in global_ids})
            won = battle["winner"] == side
            for hero_id in picks:
                hero_counts[hero_id] += 1
                hero_wins[hero_id] += int(won)
            for a, b in combinations(picks, 2):
                pairs[f"{a}_{b}"][0] += 1
                pairs[f"{a}_{b}"][1] += int(won)
            side_picks = [hero_id for team, kind, hero_id in actions if team == side and kind == "pick"]
            for hero_id in side_picks[:1 if side == "blue" else 2]:
                if hero_id in global_ids:
                    openers[str(hero_id)]["b1_picks" if side == "blue" else "r1_r2_picks"] += 1
        for side, action, hero_id in actions[:4]:
            if action == "ban" and hero_id in global_ids:
                openers[str(hero_id)]["p1_bans"] += 1
    priors = {"b1_openers": dict(openers), "pairs": {}}
    for key, (count, wins) in pairs.items():
        a, b = map(int, key.split("_"))
        baseline = (hero_wins[a] / hero_counts[a] + hero_wins[b] / hero_counts[b]) / 2
        priors["pairs"][key] = {"matches": count, "win_rate": wins / count, "synergy_lift": wins / count - baseline}
    # Interleave action stages instead of allowing early bans to dominate the sample.
    buckets = defaultdict(list)
    eligible_games = 0
    for battle_id, battle in battles.items():
        if battle["date"] < cutoff or len(battle["actions"]) != len(SEQUENCE):
            continue
        actions = battle["actions"]
        if any((side, action) != SEQUENCE[index] or hero_id not in global_ids for index, (side, action, hero_id) in enumerate(actions)):
            continue
        if len({hero_id for _, _, hero_id in actions}) != 18:
            continue
        eligible_games += 1
        position = {"step": 0, "picks": {"blue": [], "red": []}, "bans": {"blue": [], "red": []}}
        for index, (side, action, hero_id) in enumerate(actions):
            if index in (0, 4, 5, 6, 10, 14, 15, 16, 17):
                buckets[index].append({"battle_id": battle_id, "date": battle["date"], "position": json.loads(json.dumps(position)), "expected_hero_id": hero_id})
            position["picks" if action == "pick" else "bans"][side].append(hero_id)
            position["step"] += 1
    positions = []
    offset = 0
    while len(positions) < limit:
        added = False
        for stage_index, step in enumerate(sorted(buckets)):
            # One position per battle, rotating through draft stages.
            sample_index = offset * len(buckets) + stage_index
            if sample_index < len(buckets[step]) and len(positions) < limit:
                positions.append(buckets[step][sample_index])
                added = True
        if not added:
            break
        offset += 1
    return {
        "cutoff": cutoff, "training_battles": training, "eligible_holdout_battles": eligible_games,
        "synergy": priors, "positions": positions,
        "limitations": "Agreement with historical choices is diagnostic, not a win-rate estimate. Current Global roster, roles and public stats differ from historical CN patches; Fearless history is omitted for single-game positions.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "data/processed/hok_drafts.db")
    # KPL moved to 20 actions in 2025; hold out 2024 for this 18-action simulator.
    parser.add_argument("--cutoff", default="2024-01-01")
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--output", type=Path, default=ROOT / "data/processed/draft_benchmark.json")
    args = parser.parse_args()
    result = export(args.database, args.cutoff, args.limit)
    if not result["positions"]:
        parser.error("Tidak ada posisi holdout yang cocok dengan aturan 18 aksi dan roster Global.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Training battles: {result['training_battles']}; eligible holdout games: {result['eligible_holdout_battles']}; positions: {len(result['positions'])}")


if __name__ == "__main__":
    main()
