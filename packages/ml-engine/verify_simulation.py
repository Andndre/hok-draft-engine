import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
HERO_META_PATH = ROOT_DIR / "apps" / "web" / "public" / "hero_metadata.json"
SYNERGY_PATH = ROOT_DIR / "apps" / "web" / "public" / "kpl_synergy_matrix.json"

with open(HERO_META_PATH, 'r', encoding='utf-8') as f:
    heroes = json.load(f)
with open(SYNERGY_PATH, 'r', encoding='utf-8') as f:
    syn = json.load(f)
b1_openers = syn.get('b1_openers', {})

cn_only = {194, 525, 312, 548, 186, 527, 518, 550, 544, 515, 136, 549, 151, 540, 188, 529, 144, 511}
global_heroes = [h for h in heroes if h['hero_id'] not in cn_only]

def compute_opener_score(hero, for_blue=True, only_global=True):
    tier_weight = {'S': 0.65, 'A': 0.25, 'B': 0.0, 'C': -0.25, 'D': -0.5}.get(hero.get('tier', 'B'), 0)
    kpl_stat = b1_openers.get(str(hero['hero_id']), {})
    b1_count = kpl_stat.get('b1_picks', 0)
    r1_count = kpl_stat.get('r1_r2_picks', 0)
    p1_bans = kpl_stat.get('p1_bans', 0)
    is_immobile = hero['hero_id'] in [112, 169, 142, 109, 504]
    opener_penalty = -2.5 if is_immobile else 0
    kpl_bonus = min(0.85, b1_count / 400 + p1_bans / 1200) if for_blue else min(0.85, r1_count / 500 + b1_count / 600 + p1_bans / 1200)
    flex_bonus = 0.15 if len(hero.get('lanes', [])) > 1 else 0
    return (hero['win_rate'] - 0.48) * 4.5 + hero['pick_rate'] * 3.5 + tier_weight + kpl_bonus + flex_bonus + opener_penalty

def simulate_step(step, is_blue, planned_opener):
    scores = []
    for cand in global_heroes:
        tier_bonus = {'S': 0.35, 'A': 0.20, 'B': 0.05, 'C': -0.10, 'D': -0.25}.get(cand.get('tier', 'B'), 0.0)
        score = (cand['win_rate'] - 0.48) * 4.0 + tier_bonus + cand['pick_rate'] * 2.8
        is_immobile = cand['hero_id'] in [112, 169, 142, 109, 504]

        if step < 4: # BAN_PHASE_1
            if is_immobile:
                score -= 2.2
            kpl_info = b1_openers.get(str(cand['hero_id']), {})
            p1_bans = kpl_info.get('p1_bans', 0)
            if is_blue:
                if planned_opener and cand['hero_id'] == planned_opener['hero_id']:
                    score -= 3.0
                elif planned_opener:
                    # cand counters planned_opener
                    is_counter = any(c['target_id'] == planned_opener['hero_id'] for c in cand.get('counters', []))
                    if is_counter:
                        score += 1.25
                    elif cand['primary_lane'] == planned_opener['primary_lane'] and (cand.get('tier') == 'S' or p1_bans >= 80):
                        score += 0.65
                    elif p1_bans >= 120 or cand.get('ban_rate', 0) >= 0.25:
                        score += 0.55
            else: # red
                if planned_opener and cand['hero_id'] == planned_opener['hero_id']:
                    score -= 2.5
        elif step < 10: # PICK_PHASE_1
            kpl_info = b1_openers.get(str(cand['hero_id']), {})
            if step == 4 and planned_opener and cand['hero_id'] == planned_opener['hero_id']:
                score += 1.45
            elif step <= 6 and not is_immobile and (cand.get('tier') == 'S' or kpl_info.get('b1_picks', 0) >= 100):
                score += compute_opener_score(cand, is_blue, True) * 0.45
            elif step == 4 and is_immobile and cand['hero_id'] != (planned_opener['hero_id'] if planned_opener else None):
                score -= 2.0

        scores.append((cand, score))
    
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores

if __name__ == "__main__":
    ranked_openers = sorted(global_heroes, key=lambda h: compute_opener_score(h, True, True), reverse=True)
    planned = ranked_openers[0]
    print(f"Top Planned Opener: {planned['name']} (score: {compute_opener_score(planned):.3f})\n")

    for s in [0, 1, 2, 3, 4]:
        side = "BLUE" if s in [0, 2, 4] else "RED"
        act = "BAN" if s < 4 else "PICK"
        res = simulate_step(s, side == "BLUE", planned)
        print(f"--- Step {s} ({side} {act}) ---")
        for rank, (cand, sc) in enumerate(res[:5], 1):
            print(f"  #{rank}: {cand['name']} (ID {cand['hero_id']}, Tier {cand.get('tier')}) -> score: {sc:.3f}")
        luban_entry = next(((rank, sc) for rank, (cand, sc) in enumerate(res, 1) if cand['hero_id'] == 112), None)
        if luban_entry:
            print(f"  >> Luban No.7 is #{luban_entry[0]} of {len(res)} (score: {luban_entry[1]:.3f})\n")
