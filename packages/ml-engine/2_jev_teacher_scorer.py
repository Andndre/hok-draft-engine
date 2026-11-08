"""2_jev_teacher_scorer.py
Jev-Style System One Decision Teacher:
- Computes empirical synergy and counter matrices from KPL battles + Kurohiko priors
- Evaluates full and partial draft states across 6 calibrated tactical dimensions:
    1. win_probability (0.0 - 1.0)
    2. early_game_pressure (0.0 - 1.0)
    3. cc_chain_lockdown (0.0 - 1.0)
    4. frontline_durability (0.0 - 1.0)
    5. enemy_carry_shutdown (0.0 - 1.0)
    6. draft_flexibility (0.0 - 1.0)
- Generates distilled training tuples (draft_state, target_choice_probs, target_scores_vector)
  stored in data/processed/teacher_draft_dataset.pt / .json
"""

import os
import json
import sqlite3
import numpy as np
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple, Any

ROOT_DIR = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
MAPPINGS_FILE = ROOT_DIR / "data" / "mappings" / "master_heroes_global.json"
DB_PATH = PROCESSED_DIR / "hok_drafts.db"
OUTPUT_DATASET = PROCESSED_DIR / "teacher_draft_dataset.npz"

def sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))

class JevTeacherScorer:
    def __init__(self):
        with open(MAPPINGS_FILE, "r", encoding="utf-8") as f:
            self.master_heroes = json.load(f)
            
        self.num_heroes = len(self.master_heroes)
        self.hero_ids = [h["hero_id"] for h in self.master_heroes]
        self.id_to_idx = {hid: idx for idx, hid in enumerate(self.hero_ids)}
        self.idx_to_id = {idx: hid for idx, hid in enumerate(self.hero_ids)}
        
        # Base tactical traits for each hero [num_heroes, 5] (early, cc, frontline, shutdown, flexibility)
        self.hero_traits = np.zeros((self.num_heroes, 5), dtype=np.float32)
        self.win_rate_prior = np.zeros(self.num_heroes, dtype=np.float32)
        
        # Counter matrix: counter_matrix[attacker_idx, defender_idx] > 0
        self.counter_matrix = np.zeros((self.num_heroes, self.num_heroes), dtype=np.float32)
        
        self._init_hero_archetypes()
        self._init_counter_priors()
        self.synergy_matrix = np.zeros((self.num_heroes, self.num_heroes), dtype=np.float32)
        self._load_empirical_kpl_stats()

    def _init_hero_archetypes(self):
        for idx, h in enumerate(self.master_heroes):
            role = h.get("primary_role", "Fighter")
            lanes = h.get("lanes", ["Mid"])
            tier = h.get("tier", "B")
            self.win_rate_prior[idx] = h.get("win_rate", 0.50)
            
            # Default baselines by role
            # [early_game, cc_chain, frontline, shutdown, flexibility]
            if role == "Assassin":
                base = [0.85, 0.40, 0.25, 0.88, 0.50]
            elif role == "Mage":
                base = [0.60, 0.70, 0.20, 0.65, 0.55]
            elif role == "Marksman":
                base = [0.45, 0.30, 0.20, 0.55, 0.40]
            elif role == "Fighter":
                base = [0.70, 0.60, 0.75, 0.70, 0.65]
            elif role == "Tank":
                base = [0.50, 0.85, 0.95, 0.60, 0.55]
            elif role == "Support":
                base = [0.55, 0.80, 0.50, 0.55, 0.70]
            else:
                base = [0.50, 0.50, 0.50, 0.50, 0.50]
                
            # Flexibility boost if multiple lanes
            if len(lanes) > 1:
                base[4] += 0.20
            # Tier multiplier
            tier_bonus = {"S": 0.08, "A": 0.04, "B": 0.00, "C": -0.04, "D": -0.08}.get(tier, 0.0)
            for i in range(5):
                base[i] = np.clip(base[i] + tier_bonus, 0.05, 0.98)
                
            self.hero_traits[idx] = base

    def _init_counter_priors(self):
        for idx, h in enumerate(self.master_heroes):
            # h counters each item in h["counters"]
            for c in h.get("counters", []):
                target_id = c.get("target_id")
                if target_id and target_id in self.id_to_idx:
                    t_idx = self.id_to_idx[target_id]
                    weight = 0.35 if c.get("severity") == "hard" else 0.18
                    self.counter_matrix[idx, t_idx] = weight

    def _load_empirical_kpl_stats(self):
        print(" [Teacher] Computing empirical synergy & head-to-head records from SQLite...")
        if not DB_PATH.exists():
            return
            
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Load all completed matches draft actions
        cursor.execute("""
        SELECT b.battle_id, b.winner_side, da.side, da.global_hero_id
        FROM battles b
        JOIN draft_actions da ON b.battle_id = da.battle_id
        WHERE da.action = 'pick' AND b.is_complete = 1
        """)
        
        team_picks = defaultdict(lambda: {"blue": [], "red": [], "winner": ""})
        for b_id, winner_side, side, hid in cursor.fetchall():
            if hid in self.id_to_idx:
                team_picks[b_id][side].append(self.id_to_idx[hid])
                team_picks[b_id]["winner"] = winner_side
                
        conn.close()
        
        pair_counts = defaultdict(int)
        pair_wins = defaultdict(int)
        
        for b_id, data in team_picks.items():
            for side in ["blue", "red"]:
                picks = data[side]
                won = (data["winner"] == side)
                for i in range(len(picks)):
                    for j in range(i + 1, len(picks)):
                        p1, p2 = min(picks[i], picks[j]), max(picks[i], picks[j])
                        pair_counts[(p1, p2)] += 1
                        if won:
                            pair_wins[(p1, p2)] += 1

        for (p1, p2), total in pair_counts.items():
            if total >= 5:
                wr = pair_wins[(p1, p2)] / total
                delta = wr - 0.50
                self.synergy_matrix[p1, p2] = delta
                self.synergy_matrix[p2, p1] = delta

        print(f" [Teacher] Calculated synergies for {len(pair_counts)} hero pairs.")

    def score_draft_state(
        self, 
        our_picks: List[int], 
        enemy_picks: List[int]
    ) -> Tuple[float, float, float, float, float, float]:
        """
        Returns 6-dimensional calibrated tactical scores:
        (win_prob, early_game, cc_chain, frontline, carry_shutdown, flexibility)
        """
        if not our_picks:
            return (0.50, 0.50, 0.50, 0.50, 0.50, 0.50)
            
        our_indices = [self.id_to_idx[hid] for hid in our_picks if hid in self.id_to_idx]
        enemy_indices = [self.id_to_idx[hid] for hid in enemy_picks if hid in self.id_to_idx]
        
        # 1. Base traits aggregation
        our_traits = np.mean(self.hero_traits[our_indices], axis=0) # [early, cc, frontline, shutdown, flex]
        enemy_traits = np.mean(self.hero_traits[enemy_indices], axis=0) if enemy_indices else np.array([0.5, 0.5, 0.5, 0.5, 0.5])
        
        early_pressure = float(our_traits[0])
        cc_lockdown = float(our_traits[1])
        frontline = float(our_traits[2])
        flexibility = float(our_traits[4])
        
        # 2. Shutdown calculation: base shutdown + direct counter matrix advantage
        counter_bonus = 0.0
        if enemy_indices:
            # sum counter weights from our team against enemy team
            for o_idx in our_indices:
                for e_idx in enemy_indices:
                    counter_bonus += self.counter_matrix[o_idx, e_idx]
            counter_bonus /= max(1, len(enemy_indices))
            
        carry_shutdown = float(np.clip(our_traits[3] + counter_bonus, 0.0, 1.0))
        
        # 3. Synergy bonus
        synergy_sum = 0.0
        pair_cnt = 0
        for i in range(len(our_indices)):
            for j in range(i + 1, len(our_indices)):
                synergy_sum += self.synergy_matrix[our_indices[i], our_indices[j]]
                pair_cnt += 1
        avg_synergy = (synergy_sum / pair_cnt) if pair_cnt > 0 else 0.0
        
        # 4. Win probability formula
        base_win_rate = float(np.mean([self.win_rate_prior[i] for i in our_indices]))
        
        trait_diff = (
            (early_pressure - enemy_traits[0]) * 0.15 +
            (cc_lockdown - enemy_traits[1]) * 0.20 +
            (frontline - enemy_traits[2]) * 0.20 +
            (carry_shutdown - enemy_traits[3]) * 0.25
        )
        
        logit = (base_win_rate - 0.50) * 3.0 + trait_diff * 1.5 + avg_synergy * 2.0
        win_prob = float(np.clip(sigmoid(logit), 0.10, 0.90))
        
        return (
            round(win_prob, 4),
            round(early_pressure, 4),
            round(cc_lockdown, 4),
            round(frontline, 4),
            round(carry_shutdown, 4),
            round(flexibility, 4)
        )

    def generate_training_dataset(self, num_samples: int = 15000):
        print(f"\n [Teacher] Generating {num_samples} distilled Jev decision states...")
        
        # Features:
        # our_picks: [5] (padded with -1)
        # enemy_picks: [5] (padded with -1)
        # bans: [10] (padded with -1)
        # fearless_mask: [120] (binary 0/1)
        # phase_id: int (0=ban, 1=pick)
        # side_id: int (0=blue, 1=red)
        
        all_features_our = []
        all_features_enemy = []
        all_features_bans = []
        all_fearless = []
        all_meta = [] # [phase, side, pick_idx]
        
        all_target_choice = [] # [120] distribution
        all_target_scores = [] # [6] tactical vector
        
        # 1. Use real KPL draft histories
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT battle_id FROM battles WHERE is_complete = 1 LIMIT 3000")
        sample_battles = [r[0] for r in cursor.fetchall()]
        
        for b_id in sample_battles:
            cursor.execute("""
            SELECT ord, side, action, global_hero_id 
            FROM draft_actions 
            WHERE battle_id = ? 
            ORDER BY ord ASC
            """, (b_id,))
            actions = cursor.fetchall()
            
            blue_picks = []
            red_picks = []
            bans = []
            unavailable = set()
            
            for ord_id, side, action, hid in actions:
                if hid not in self.id_to_idx:
                    continue
                hero_idx = self.id_to_idx[hid]
                
                # Snapshot state right before this pick/ban
                is_pick = (action == "pick")
                active_our = blue_picks if side == "blue" else red_picks
                active_enemy = red_picks if side == "blue" else blue_picks
                
                if len(active_our) < 5 and len(active_enemy) <= 5:
                    # Target choice: 1-hot or smoothed distribution
                    choice_dist = np.zeros(self.num_heroes, dtype=np.float32)
                    choice_dist[hero_idx] = 1.0
                    
                    # Compute tactical vector with this hero added
                    cand_our = active_our + [hid]
                    scores = self.score_draft_state(cand_our, active_enemy)
                    
                    # Pad inputs
                    p_our = (active_our + [-1] * 5)[:5]
                    p_enemy = (active_enemy + [-1] * 5)[:5]
                    p_bans = (bans + [-1] * 10)[:10]
                    mask = np.zeros(self.num_heroes, dtype=np.float32)
                    for u in unavailable:
                        if u in self.id_to_idx:
                            mask[self.id_to_idx[u]] = 1.0
                            
                    all_features_our.append(p_our)
                    all_features_enemy.append(p_enemy)
                    all_features_bans.append(p_bans)
                    all_fearless.append(mask)
                    all_meta.append([1 if is_pick else 0, 0 if side == "blue" else 1, len(active_our)])
                    
                    all_target_choice.append(choice_dist)
                    all_target_scores.append(list(scores))
                    
                if action == "pick":
                    if side == "blue":
                        blue_picks.append(hid)
                    else:
                        red_picks.append(hid)
                    unavailable.add(hid)
                elif action == "ban":
                    bans.append(hid)
                    unavailable.add(hid)
                    
        conn.close()
        
        # 2. Augment with synthetic Global meta scenarios (for Global exclusive heroes)
        needed = num_samples - len(all_features_our)
        if needed > 0:
            print(f"       Augmenting with {needed} synthetic Global draft states...")
            for _ in range(needed):
                n_our = np.random.randint(0, 5)
                n_enemy = np.random.randint(0, 5)
                n_bans = np.random.randint(0, 7)
                
                pool = self.hero_ids.copy()
                np.random.shuffle(pool)
                
                sample_bans = pool[:n_bans]
                rem = pool[n_bans:]
                sample_our = rem[:n_our]
                rem2 = rem[n_our:]
                sample_enemy = rem2[:n_enemy]
                cand_pool = rem2[n_enemy:]
                
                if not cand_pool:
                    continue
                    
                # Pick best hero via teacher evaluation
                best_hid = None
                best_score = -1.0
                best_vec = None
                
                # Subsample 15 candidates for speed
                test_cands = np.random.choice(cand_pool, size=min(15, len(cand_pool)), replace=False)
                for cand in test_cands:
                    scores = self.score_draft_state(sample_our + [cand], sample_enemy)
                    win_p = scores[0]
                    if win_p > best_score:
                        best_score = win_p
                        best_hid = cand
                        best_vec = scores
                        
                if best_hid is not None:
                    choice_dist = np.zeros(self.num_heroes, dtype=np.float32)
                    choice_dist[self.id_to_idx[best_hid]] = 1.0
                    
                    mask = np.zeros(self.num_heroes, dtype=np.float32)
                    for u in (sample_bans + sample_our + sample_enemy):
                        mask[self.id_to_idx[u]] = 1.0
                        
                    all_features_our.append((sample_our + [-1] * 5)[:5])
                    all_features_enemy.append((sample_enemy + [-1] * 5)[:5])
                    all_features_bans.append((sample_bans + [-1] * 10)[:10])
                    all_fearless.append(mask)
                    all_meta.append([1, 0, n_our])
                    all_target_choice.append(choice_dist)
                    all_target_scores.append(list(best_vec))

        print(f" [Teacher] Saving {len(all_features_our)} training pairs to {OUTPUT_DATASET}...")
        np.savez_compressed(
            OUTPUT_DATASET,
            our_picks=np.array(all_features_our, dtype=np.int32),
            enemy_picks=np.array(all_features_enemy, dtype=np.int32),
            bans=np.array(all_features_bans, dtype=np.int32),
            fearless_masks=np.array(all_fearless, dtype=np.float32),
            meta_info=np.array(all_meta, dtype=np.int32),
            target_choices=np.array(all_target_choice, dtype=np.float32),
            target_scores=np.array(all_target_scores, dtype=np.float32),
        )
        print(" [Teacher] Distillation dataset creation complete.")

if __name__ == "__main__":
    scorer = JevTeacherScorer()
    scorer.generate_training_dataset(num_samples=16000)
