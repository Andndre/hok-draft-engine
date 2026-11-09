import * as ort from 'onnxruntime-web';
import { Hero, TacticalVector, Lane } from '../types';
import { loadOnnxModelBuffer } from './r2ModelLoader';

// Configure ONNX Runtime Web WASM paths
try {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
  ort.env.wasm.numThreads = 1;
} catch (e) {
  console.warn('[JevEngine] WASM config warning:', e);
}

let inferenceSession: ort.InferenceSession | null = null;
let sessionInitPromise: Promise<ort.InferenceSession | null> | null = null;
let kplSynergyData: Record<string, any> | null = null;

async function loadKplSynergyData(): Promise<Record<string, any> | null> {
  if (kplSynergyData) return kplSynergyData;
  try {
    const res = await fetch('/kpl_synergy_matrix.json');
    if (res.ok) {
      kplSynergyData = await res.json();
      console.log(`[JevEngine] Loaded ${kplSynergyData?.total_pro_pairs || 0} empirical KPL pro synergy pairs`);
    }
  } catch (err) {
    console.warn('[JevEngine] Could not load kpl_synergy_matrix.json:', err);
  }
  return kplSynergyData;
}

export async function getInferenceSession(): Promise<ort.InferenceSession | null> {
  if (inferenceSession) return inferenceSession;
  if (sessionInitPromise) return sessionInitPromise;

  sessionInitPromise = (async () => {
    try {
      const buffer = await loadOnnxModelBuffer();
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic',
      });
      inferenceSession = session;
      return session;
    } catch (err) {
      console.warn('[JevEngine] ONNX session creation fallback to calibrated empirical engine:', err);
      return null;
    }
  })();

  return sessionInitPromise;
}

export type TournamentPhaseId =
  | 'BAN_PHASE_1'
  | 'PICK_PHASE_1'
  | 'BAN_PHASE_2'
  | 'PICK_PHASE_2'
  | 'DRAFT_COMPLETE';

export interface TournamentPhaseStrategy {
  phaseId: TournamentPhaseId;
  phaseTitle: string;
  phaseObjective: string;
  plannedOpener: Hero | null;
  activePlan: 'PLAN_A' | 'PLAN_B' | 'AI_FALLBACK';
  planAHero: Hero | null;
  planBHero: Hero | null;
  isPlanABanned: boolean;
  isPlanBBanned: boolean;
  candidateOpeners: Hero[];
  bannedOpenerCounters: string[];
  ourVacantLanes: Lane[];
  enemyVacantLanes: Lane[];
}

export interface JevPredictionResult {
  tacticalScores: TacticalVector;
  recommendations: Array<{
    hero: Hero;
    probability: number;
    choiceScore: number;
    proComboTag?: string;
    laneTag?: string;
  }>;
  phaseStrategy: TournamentPhaseStrategy;
  latencyMs: number;
  isNeural: boolean;
}

/**
 * Calculates occupied and vacant lanes for a given set of picked heroes.
 * Ensures a greedy 1-to-1 assignment for flex heroes so all 5 lanes are tracked accurately.
 */
function analyzeLaneOccupancy(pickedHeroes: Hero[]): {
  occupiedLanes: Set<Lane>;
  vacantLanes: Set<Lane>;
} {
  const ALL_LANES: Lane[] = ['Clash', 'Jungle', 'Mid', 'Farm', 'Roam'];
  const occupiedLanes = new Set<Lane>();

  for (const h of pickedHeroes) {
    if (h.primary_lane && !occupiedLanes.has(h.primary_lane)) {
      occupiedLanes.add(h.primary_lane);
    } else {
      const altLane = h.lanes?.find((l) => !occupiedLanes.has(l));
      if (altLane) occupiedLanes.add(altLane);
      else if (h.primary_lane) occupiedLanes.add(h.primary_lane);
    }
  }

  const vacantLanes = new Set<Lane>(ALL_LANES.filter((l) => !occupiedLanes.has(l)));
  return { occupiedLanes, vacantLanes };
}

/**
 * Computes how strong a hero is as a Phase 1 First-Pick / Core Opener (S-Tier + KPL B1/R1 frequency).
 */
function computeOpenerPriorityScore(
  hero: Hero,
  b1Openers: Record<string, any>,
  forBlueSide: boolean
): number {
  const tierWeight = { S: 0.65, A: 0.25, B: 0.0, C: -0.25, D: -0.5 }[hero.tier] ?? 0;
  const kplStat = b1Openers[String(hero.hero_id)];
  const b1Count = kplStat?.b1_picks || 0;
  const r1Count = kplStat?.r1_r2_picks || 0;
  const p1Bans = kplStat?.p1_bans || 0;

  const kplOpenerBonus = forBlueSide
    ? Math.min(0.85, b1Count / 400 + p1Bans / 1200)
    : Math.min(0.85, r1Count / 500 + b1Count / 600 + p1Bans / 1200);

  const flexBonus = hero.lanes.length > 1 ? 0.12 : 0;
  return (hero.win_rate - 0.48) * 4.5 + hero.pick_rate * 3.5 + tierWeight + kplOpenerBonus + flexBonus;
}

export async function runJevInference(
  ourHeroIds: number[],
  enemyHeroIds: number[],
  bannedHeroIds: number[],
  fearlessUnavailableIds: number[],
  isPickPhase: boolean,
  isBlueSide: boolean,
  heroes: Hero[],
  draftStep: number = 0,
  planAId?: number | null,
  planBId?: number | null
): Promise<JevPredictionResult> {
  const t0 = performance.now();
  const synergyDb = await loadKplSynergyData();

  const idMap = new Map<number, Hero>();
  const idToIndex = new Map<number, number>();
  heroes.forEach((h, idx) => {
    idMap.set(h.hero_id, h);
    idToIndex.set(h.hero_id, idx);
  });

  const ourHeroes = ourHeroIds.map((id) => idMap.get(id)).filter(Boolean) as Hero[];
  const enemyHeroes = enemyHeroIds.map((id) => idMap.get(id)).filter(Boolean) as Hero[];
  const bannedHeroes = bannedHeroIds.map((id) => idMap.get(id)).filter(Boolean) as Hero[];

  // 1. Both Teams' Lane Occupancy Analysis
  const { occupiedLanes: ourOccupiedLanes, vacantLanes: ourVacantLanes } = analyzeLaneOccupancy(ourHeroes);
  const { occupiedLanes: enemyOccupiedLanes, vacantLanes: enemyVacantLanes } = analyzeLaneOccupancy(enemyHeroes);

  // 2. Build unavailable mask
  const maskArr = new Float32Array(heroes.length);
  const unavailableSet = new Set([
    ...ourHeroIds,
    ...enemyHeroIds,
    ...bannedHeroIds,
    ...fearlessUnavailableIds,
  ]);
  unavailableSet.forEach((hid) => {
    const idx = idToIndex.get(hid);
    if (idx !== undefined && idx < heroes.length) {
      maskArr[idx] = 1.0;
    }
  });

  // 3. Determine Tournament Phase (0..3 Ban1, 4..9 Pick1, 10..13 Ban2, 14..17 Pick2)
  let phaseId: TournamentPhaseId = 'BAN_PHASE_1';
  if (draftStep >= 18) {
    phaseId = 'DRAFT_COMPLETE';
  } else if (draftStep < 4) {
    phaseId = 'BAN_PHASE_1';
  } else if (draftStep < 10) {
    phaseId = 'PICK_PHASE_1';
  } else if (draftStep < 14) {
    phaseId = 'BAN_PHASE_2';
  } else {
    phaseId = 'PICK_PHASE_2';
  }

  const proPairs = synergyDb?.pairs || {};
  const b1Openers = synergyDb?.b1_openers || {};
  const phase2BanVsEnemy = synergyDb?.phase2_ban_vs_enemy || {};
  const phase2BanProtectOur = synergyDb?.phase2_ban_protect_our || {};
  const dunshanPairs = synergyDb?.dunshan_pair_counters || {};

  // 4. Identify Top Available Meta Openers for Phase 1 Strategy
  const availableHeroes = heroes.filter((_, idx) => maskArr[idx] === 0);
  const rankedOpeners = [...availableHeroes].sort(
    (a, b) => computeOpenerPriorityScore(b, b1Openers, isBlueSide) - computeOpenerPriorityScore(a, b1Openers, isBlueSide)
  );

  // Top candidate openers for recommendation / quick selection
  const candidateOpeners = rankedOpeners.slice(0, 8);

  // Determine Plan A and Plan B:
  let planAHero: Hero | null = planAId ? idMap.get(planAId) || null : null;
  let planBHero: Hero | null = planBId ? idMap.get(planBId) || null : null;

  // Auto-suggest Plan A if not specified
  if (!planAHero && rankedOpeners.length > 0) {
    planAHero = rankedOpeners[0];
  }
  // Auto-suggest Plan B if not specified (pick hero with different role or primary lane)
  if (!planBHero && rankedOpeners.length > 1) {
    const fallbackOp = rankedOpeners.find((h) => h.hero_id !== planAHero?.hero_id && h.primary_lane !== planAHero?.primary_lane);
    planBHero = fallbackOp || rankedOpeners[1];
  }

  const isPlanABanned = Boolean(planAHero && bannedHeroIds.includes(planAHero.hero_id));
  const isPlanAPicked = Boolean(planAHero && (ourHeroIds.includes(planAHero.hero_id) || enemyHeroIds.includes(planAHero.hero_id)));
  const isPlanBBanned = Boolean(planBHero && bannedHeroIds.includes(planBHero.hero_id));
  const isPlanBPicked = Boolean(planBHero && (ourHeroIds.includes(planBHero.hero_id) || enemyHeroIds.includes(planBHero.hero_id)));

  // Resolve Active Planned Opener:
  let plannedOpener: Hero | null = null;
  let activePlan: 'PLAN_A' | 'PLAN_B' | 'AI_FALLBACK' = 'PLAN_A';

  if (planAHero && !unavailableSet.has(planAHero.hero_id)) {
    plannedOpener = planAHero;
    activePlan = 'PLAN_A';
  } else if (planBHero && !unavailableSet.has(planBHero.hero_id)) {
    plannedOpener = planBHero;
    activePlan = 'PLAN_B';
  } else if (rankedOpeners.length > 0) {
    plannedOpener = rankedOpeners[0];
    activePlan = 'AI_FALLBACK';
  }

  // Helper: Check if `counterCand` is a counter to `targetHero` (via Kurohiko matrix, HOKFIRE guide, or KPL Pre-Ban history)
  const getCounterStrengthAgainst = (counterCand: Hero, targetHero: Hero): { isCounter: boolean; kplPrebanCount: number; reason?: string } => {
    const directCounter = counterCand.counters.find((c) => c.target_id === targetHero.hero_id);
    const reverseCountered = targetHero.countered_by?.find((c) => c.counter_id === counterCand.hero_id);
    const kplPrebans: Array<{ ban_id: number; count: number }> = b1Openers[String(targetHero.hero_id)]?.top_prebans || [];
    const prebanEntry = kplPrebans.find((p) => p.ban_id === counterCand.hero_id);
    const kplPrebanCount = prebanEntry ? prebanEntry.count : 0;

    // Check HOKFIRE guide official matchups (weak_against / strong_against)
    const candCleanSlug = counterCand.slug.replace(/-/g, '').toLowerCase();
    const targetCleanSlug = targetHero.slug.replace(/-/g, '').toLowerCase();

    const isHokfireWeakAgainst = Boolean(
      targetHero.hokfire_counters?.weak_against?.some((s) => s.replace(/-/g, '').toLowerCase() === candCleanSlug)
    );
    const isHokfireStrongAgainst = Boolean(
      counterCand.hokfire_counters?.strong_against?.some((s) => s.replace(/-/g, '').toLowerCase() === targetCleanSlug)
    );

    const isCounter = Boolean(directCounter || reverseCountered || isHokfireWeakAgainst || isHokfireStrongAgainst || kplPrebanCount >= 12);
    let reason = directCounter?.reason || reverseCountered?.reason;
    if (!reason && (isHokfireWeakAgainst || isHokfireStrongAgainst)) {
      reason = `HOKFIRE Official Counter: ${counterCand.name} unggul terhadap ${targetHero.name}`;
    }

    return {
      isCounter,
      kplPrebanCount: kplPrebanCount + (isHokfireWeakAgainst || isHokfireStrongAgainst ? 25 : 0),
      reason,
    };
  };

  // Check which counters to `plannedOpener` have ALREADY been banned in this draft
  const bannedOpenerCounters: string[] = [];
  if (plannedOpener) {
    for (const bh of bannedHeroes) {
      const check = getCounterStrengthAgainst(bh, plannedOpener);
      if (check.isCounter) {
        bannedOpenerCounters.push(bh.name);
      }
    }
  }

  // 5. Base traits & 6-Axis Tactical Dimensions calculation
  let early = 0.5;
  let cc = 0.5;
  let frontline = 0.5;
  let shutdown = 0.5;
  let flex = 0.5;
  let winProb = 0.5;

  if (ourHeroes.length > 0) {
    const roleCounts: Record<string, number> = {};
    let totalWr = 0;

    for (const h of ourHeroes) {
      roleCounts[h.primary_role] = (roleCounts[h.primary_role] || 0) + 1;
      totalWr += h.win_rate;
    }

    const avgWr = totalWr / ourHeroes.length;
    early = Math.min(0.95, 0.35 + (roleCounts['Assassin'] || 0) * 0.18 + (roleCounts['Fighter'] || 0) * 0.10);
    cc = Math.min(0.95, 0.30 + (roleCounts['Tank'] || 0) * 0.20 + (roleCounts['Support'] || 0) * 0.18 + (roleCounts['Mage'] || 0) * 0.12);
    frontline = Math.min(0.95, 0.25 + (roleCounts['Tank'] || 0) * 0.28 + (roleCounts['Fighter'] || 0) * 0.16);
    flex = Math.min(0.95, 0.40 + ourHeroes.filter((h) => h.lanes.length > 1).length * 0.15);

    let counterAdv = 0;
    for (const oh of ourHeroes) {
      for (const eh of enemyHeroes) {
        if (oh.counters.some((c) => c.target_id === eh.hero_id)) {
          counterAdv += 0.08;
        }
      }
    }
    shutdown = Math.min(0.95, 0.45 + (roleCounts['Assassin'] || 0) * 0.15 + counterAdv);
    winProb = Math.min(0.85, Math.max(0.15, avgWr + counterAdv * 0.5));
  }

  // 6. Score every available candidate using 4-Phase Tournament Strategy
  const scoredCandidates: Array<{
    hero: Hero;
    baseScore: number;
    finalScore: number;
    proComboTag?: string;
    laneTag?: string;
  }> = [];

  const hasEnemyDunshan = enemyHeroes.some((e) => e.hero_id === 509 || e.name.toLowerCase() === 'dunshan');
  const blueB1ThreatHero = rankedOpeners[0] || null;

  for (let i = 0; i < heroes.length; i++) {
    if (maskArr[i] === 1) continue;

    const cand = heroes[i];
    const tierBonus = { S: 0.35, A: 0.20, B: 0.05, C: -0.10, D: -0.25 }[cand.tier] || 0.0;
    let score = (cand.win_rate - 0.48) * 4.0 + tierBonus + cand.pick_rate * 2.8;
    let laneTag: string | undefined = undefined;
    let proComboTag: string | undefined = undefined;

    // =========================================================================
    // PHASE 1: BAN PHASE 1 (Steps 0..3) — Pre-Ban Counters to Planned Meta Opener
    // =========================================================================
    if (phaseId === 'BAN_PHASE_1') {
      const kplOpenerInfo = b1Openers[String(cand.hero_id)];
      const p1BansCount = kplOpenerInfo?.p1_bans || 0;

      if (isBlueSide) {
        // BLUE SIDE (First Pick B1 Advantage):
        // 1. NEVER ban the #1 meta opener we plan to first-pick at B1!
        if (plannedOpener && cand.hero_id === plannedOpener.hero_id) {
          score -= 3.0;
          laneTag = 'Jangan Di-Ban (Target B1)';
          proComboTag = `👑 Simpan untuk First-Pick B1 Kita!`;
        } else if (plannedOpener) {
          // 2. HIGHEST PRIORITY: Ban hard counters to our planned B1 Meta Opener!
          const counterCheck = getCounterStrengthAgainst(cand, plannedOpener);
          if (counterCheck.isCounter) {
            const prebanBoost = Math.min(0.55, counterCheck.kplPrebanCount / 160);
            score += 1.25 + prebanBoost;
            laneTag = `Counter ${plannedOpener.name}`;
            proComboTag =
              counterCheck.kplPrebanCount > 0
                ? `🎯 Amankan B1 ${plannedOpener.name}: Pre-Ban Counter (${counterCheck.kplPrebanCount}x di KPL)`
                : `🎯 Amankan B1 ${plannedOpener.name}: Ban Hard Counter Utama`;
          } else if (cand.primary_lane === plannedOpener.primary_lane && (cand.tier === 'S' || p1BansCount >= 80)) {
            // 3. Same-lane S-Tier rival: if we pick `plannedOpener`, Red could respond with this rival at R1/R2
            score += 0.65 + Math.min(0.35, p1BansCount / 400);
            laneTag = `Deny Respon ${cand.primary_lane}`;
            proComboTag = `🚫 Cegah Red ambil ${cand.name} di R1+R2 sbg lawan ${plannedOpener.name}`;
          } else if (p1BansCount >= 120 || cand.ban_rate >= 0.25) {
            // 4. High KPL Phase 1 Ban threat that Red could abuse in R1+R2 double pick
            score += 0.55 + Math.min(0.40, p1BansCount / 500);
            laneTag = 'Ancaman R1+R2 Red';
            proComboTag = `🚫 Meta Threat R1+R2 (${p1BansCount}x Phase-1 Ban KPL)`;
          }
        }
      } else {
        // RED SIDE (Second Pick R1+R2 — Must Deny Blue's B1 Opener & Protect R1+R2):
        // 1. Protect Red's own planned R1 opener from being self-banned
        if (plannedOpener && cand.hero_id === plannedOpener.hero_id) {
          score -= 2.5;
          laneTag = 'Simpan utk R1 Kita';
          proComboTag = `👑 Simpan untuk R1+R2 Pick Kita!`;
        } else if (blueB1ThreatHero && cand.hero_id === blueB1ThreatHero.hero_id) {
          // 2. Deny Blue's #1 S-Tier B1 Opener!
          score += 1.35;
          laneTag = 'Wajib Deny B1 Blue';
          proComboTag = `🚫 Cegah Blue First-Pick ${cand.name} di B1 (${kplOpenerInfo?.b1_picks || 'Top'}x B1 KPL)`;
        } else if (plannedOpener) {
          const counterCheck = getCounterStrengthAgainst(cand, plannedOpener);
          if (counterCheck.isCounter) {
            // 3. Ban hard counters to Red's planned R1+R2 core
            score += 1.05 + Math.min(0.40, counterCheck.kplPrebanCount / 180);
            laneTag = `Counter ${plannedOpener.name}`;
            proComboTag = `🛡️ Amankan R1+R2 ${plannedOpener.name}: Ban Counter Utama`;
          } else if (cand.tier === 'S' && (kplOpenerInfo?.b1_picks || 0) >= 120) {
            // Other S-Tier B1 openers Blue might take
            score += 0.85 + Math.min(0.40, (kplOpenerInfo?.b1_picks || 0) / 400);
            laneTag = 'Ancaman B1 Blue';
            proComboTag = `🚫 Potensi First-Pick B1 Blue (${kplOpenerInfo?.b1_picks}x B1 KPL)`;
          }
        }
      }
    }

    // =========================================================================
    // PHASE 2: PICK PHASE 1 (Steps 4..9) — Secure Meta Opener, Counter & Combo
    // =========================================================================
    else if (phaseId === 'PICK_PHASE_1') {
      const kplOpenerInfo = b1Openers[String(cand.hero_id)];
      const isPrimaryOccupied = ourOccupiedLanes.has(cand.primary_lane);
      const canFlexToVacant = cand.lanes.some((l) => ourVacantLanes.has(l));

      // Strict Lane Vacancy Check (No duplicate Farm/Jungle/Mid!)
      if (ourHeroes.length > 0) {
        if (!isPrimaryOccupied) {
          score += 0.50;
          laneTag = `Isi ${cand.primary_lane}`;
        } else if (canFlexToVacant) {
          score -= 0.15;
          laneTag = `Flex ${cand.lanes.find((l) => ourVacantLanes.has(l))}`;
        } else {
          score -= 1.60; // Never recommend duplicate filled lane in tournament!
          laneTag = `${cand.primary_lane} Sudah Ada`;
        }
      } else {
        laneTag = `Opener ${cand.primary_lane}`;
      }

      // Step 4 is Blue B1 First Pick: Execute our Planned First-Pick Strategy!
      if (draftStep === 4 && plannedOpener && cand.hero_id === plannedOpener.hero_id) {
        score += 1.45;
        laneTag = 'B1 Target Utama';
        proComboTag =
          bannedOpenerCounters.length > 0
            ? `👑 Eksekusi First-Pick B1! Counter (${bannedOpenerCounters.join(', ')}) sudah di-ban`
            : `👑 First-Pick Meta Prioritas #1 (B1 Opener)`;
      } else if (draftStep <= 6 && (cand.tier === 'S' || (kplOpenerInfo?.b1_picks || 0) >= 100)) {
        // Early Phase 1 (B1 / R1+R2) Meta Priority Bonus
        const openerBoost = computeOpenerPriorityScore(cand, b1Openers, isBlueSide) * 0.45;
        score += openerBoost;
        if (!proComboTag && kplOpenerInfo?.b1_picks >= 80) {
          proComboTag = `👑 Prioritas Pembuka Turnamen (${kplOpenerInfo.b1_picks}x B1 / ${kplOpenerInfo.r1_r2_picks}x R1-R2 KPL)`;
        }
      }

      // Direct Counter to Enemy Phase 1 Picks (e.g. Red R1+R2 responding to Blue B1, or Blue B2+B3 responding to Red R1+R2)
      const counteredEnemyNames: string[] = [];
      for (const eh of enemyHeroes) {
        if (cand.counters.some((c) => c.target_id === eh.hero_id)) {
          score += 0.55;
          counteredEnemyNames.push(eh.name);
        }
      }
      if (counteredEnemyNames.length > 0) {
        proComboTag = `⚔️ Respon Counter Pick: Menangkal ${counteredEnemyNames.join(', ')}`;
      }

      // Empirical KPL Synergy & Chain CC Combos with Our Already-Picked Teammates
      for (const teammate of ourHeroes) {
        const p1 = Math.min(cand.hero_id, teammate.hero_id);
        const p2 = Math.max(cand.hero_id, teammate.hero_id);
        const pairKey = `${p1}_${p2}`;

        if (proPairs[pairKey]) {
          const pairData = proPairs[pairKey];
          const lift = pairData.synergy_lift || 0;
          const matches = pairData.matches || 0;

          if (matches >= 20 && pairData.win_rate >= 0.50) {
            score += lift * 2.2 + 0.35;
            proComboTag = `🔗 Kombo KPL: ${(pairData.win_rate * 100).toFixed(0)}% WR dg ${teammate.name} (${matches} Match)`;
          }
        }

        // Anti-Dunshan Chain CC combo check (e.g. Kui + Xiao Qiao)
        if (hasEnemyDunshan) {
          if (dunshanPairs[pairKey]) {
            const dData = dunshanPairs[pairKey];
            score += 0.55;
            proComboTag = `⚡ Counter Dunshan: ${cand.name} + ${teammate.name} (${(dData.win_rate_vs_dunshan * 100).toFixed(0)}% WR KPL)`;
          } else if (
            (cand.hero_id === 175 && teammate.hero_id === 106) ||
            (cand.hero_id === 106 && teammate.hero_id === 175)
          ) {
            score += 0.65;
            proComboTag = '⚡ Chain CC: Hook Kui + Knockup S2 Xiao Qiao tembus Dunshan';
          }
        }

        // HOKFIRE Official Synergy Check (e.g. Lady Sun + Zhang Fei / Lapulapu)
        const teamCleanSlug = teammate.slug.replace(/-/g, '').toLowerCase();
        if (cand.hokfire_counters?.synergizes?.some((s) => s.replace(/-/g, '').toLowerCase() === teamCleanSlug)) {
          score += 0.40;
          if (!proComboTag) {
            proComboTag = `✨ Sinergi Duet HOKFIRE: Duet ideal bersama ${teammate.name}`;
          }
        }
      }
    }

    // =========================================================================
    // PHASE 3: BAN PHASE 2 (Steps 10..13) — Break Enemy Combo in Vacant Lanes & Protect Core
    // =========================================================================
    else if (phaseId === 'BAN_PHASE_2') {
      // In Ban Phase 2, Enemy already has 3 heroes (3 occupied lanes, 2 vacant lanes).
      // Filter strictly by ENEMY'S VACANT LANES so we never waste a ban on a role the enemy already picked!
      const fitsEnemyVacantPrimary = enemyVacantLanes.has(cand.primary_lane);
      const fitsEnemyVacantFlex = cand.lanes.some((l) => enemyVacantLanes.has(l));

      if (fitsEnemyVacantPrimary) {
        score += 0.60;
        laneTag = `Target ${cand.primary_lane} Musuh`;
      } else if (fitsEnemyVacantFlex) {
        const flexTarget = cand.lanes.find((l) => enemyVacantLanes.has(l));
        score += 0.20;
        laneTag = `Target Flex ${flexTarget} Musuh`;
      } else {
        // Enemy ALREADY filled this hero's lane(s) in Phase 1! Wasted ban!
        score -= 2.40;
        laneTag = `Musuh Sudah Ada ${cand.primary_lane}`;
      }

      // Also avoid banning a hero we desperately need for our own vacant lane unless it's a massive enemy combo threat
      if (ourVacantLanes.has(cand.primary_lane) && !fitsEnemyVacantPrimary) {
        score -= 1.20;
      }

      // Only evaluate combo-breaking & counter-protection if the hero can actually fit the enemy's remaining lanes
      if (fitsEnemyVacantPrimary || fitsEnemyVacantFlex) {
        let bestComboThreatScore = 0;
        let comboThreatDesc: string | undefined = undefined;

        // PRIORITY 1: Break Enemy Combo (Hero in enemyVacantLanes that combos with Enemy's 3 Phase-1 picks)
        for (const eh of enemyHeroes) {
          const p1 = Math.min(cand.hero_id, eh.hero_id);
          const p2 = Math.max(cand.hero_id, eh.hero_id);
          const pairKey = `${p1}_${p2}`;

          if (proPairs[pairKey]) {
            const pairData = proPairs[pairKey];
            const matches = pairData.matches || 0;
            const wr = pairData.win_rate || 0.5;
            const lift = pairData.synergy_lift || 0;

            if (matches >= 15 && wr >= 0.50) {
              const threatVal = 0.85 + lift * 2.5 + Math.min(0.35, matches / 250);
              if (threatVal > bestComboThreatScore) {
                bestComboThreatScore = threatVal;
                comboThreatDesc = `🔗 Putus Kombo Musuh: Cegah duet ${cand.name} + ${eh.name} (${(wr * 100).toFixed(0)}% WR, ${matches} Match KPL)`;
              }
            }
          }

          // Check empirical KPL Phase 2 Ban vs Enemy Pick (`phase2_ban_vs_enemy`)
          const p2BansForEnemy: Array<{ ban_id: number; count: number }> = phase2BanVsEnemy[String(eh.hero_id)] || [];
          const p2Entry = p2BansForEnemy.find((b) => b.ban_id === cand.hero_id);
          if (p2Entry && p2Entry.count >= 10) {
            const kplBanVal = 0.75 + Math.min(0.50, p2Entry.count / 180);
            if (kplBanVal > bestComboThreatScore) {
              bestComboThreatScore = kplBanVal;
              comboThreatDesc = `🚫 Respon Ban Fase 2 KPL: Putus follow-up ${eh.name} (${p2Entry.count}x di-ban Pro)`;
            }
          }
        }

        score += bestComboThreatScore;
        if (comboThreatDesc) {
          proComboTag = comboThreatDesc;
        }

        // PRIORITY 2: Protect Our 3 Picked Heroes (Ban counters in enemyVacantLanes that threaten our core)
        const threatenedTeammates: string[] = [];
        let protectKplBonus = 0;

        for (const oh of ourHeroes) {
          if (cand.counters.some((c) => c.target_id === oh.hero_id)) {
            threatenedTeammates.push(oh.name);
            score += 0.65;
          }
          const protectList: Array<{ ban_id: number; count: number }> = phase2BanProtectOur[String(oh.hero_id)] || [];
          const protEntry = protectList.find((b) => b.ban_id === cand.hero_id);
          if (protEntry && protEntry.count >= 10) {
            protectKplBonus = Math.max(protectKplBonus, 0.45 + Math.min(0.35, protEntry.count / 180));
          }
        }

        score += protectKplBonus;
        if (threatenedTeammates.length > 0 && !proComboTag) {
          proComboTag = `🛡️ Lindungi ${threatenedTeammates.join(' & ')}: Cegah Counter di ${cand.primary_lane} Musuh`;
        } else if (threatenedTeammates.length > 0 && proComboTag) {
          proComboTag += ` + Counter ${threatenedTeammates[0]}`;
        }
      }
    }

    // =========================================================================
    // PHASE 4: PICK PHASE 2 (Steps 14..17) — Fill Remaining 2 Lanes, Counter & Complete Comp
    // =========================================================================
    else {
      const isPrimaryOccupied = ourOccupiedLanes.has(cand.primary_lane);
      const canFlexToVacant = cand.lanes.some((l) => ourVacantLanes.has(l));

      // Strict Lane Vacancy Enforcement for Final 2 Picks (B4+B5 / R4+R5)
      if (!isPrimaryOccupied) {
        score += 0.80;
        laneTag = `Wajib Isi ${cand.primary_lane}`;
      } else if (canFlexToVacant) {
        const flexLane = cand.lanes.find((l) => ourVacantLanes.has(l));
        score -= 0.25;
        laneTag = `Flex Isi ${flexLane}`;
      } else {
        score -= 2.50; // Strictly forbid duplicate lanes in Phase 2!
        laneTag = `${cand.primary_lane} Sudah Penuh`;
      }

      // Direct Counter to Enemy's 3-4 Picked Heroes (Extra weight on Step 17 R5 Last Counter-Pick!)
      const isLastPickR5 = draftStep === 17;
      const counterWeight = isLastPickR5 ? 0.70 : 0.50;
      const counteredEnemies: string[] = [];

      for (const eh of enemyHeroes) {
        if (cand.counters.some((c) => c.target_id === eh.hero_id)) {
          score += counterWeight;
          counteredEnemies.push(eh.name);
        }
      }

      if (counteredEnemies.length > 0) {
        proComboTag = isLastPickR5
          ? `🔥 Last-Pick Counter (R5): Menangkal ${counteredEnemies.join(', ')}`
          : `⚔️ Counter Pick Fase 2: Menangkal ${counteredEnemies.join(', ')}`;
      }

      // KPL Pro Synergy with our 3-4 picked heroes
      for (const teammate of ourHeroes) {
        const p1 = Math.min(cand.hero_id, teammate.hero_id);
        const p2 = Math.max(cand.hero_id, teammate.hero_id);
        const pairKey = `${p1}_${p2}`;

        if (proPairs[pairKey]) {
          const pairData = proPairs[pairKey];
          if (pairData.matches >= 20 && pairData.win_rate >= 0.50) {
            score += (pairData.synergy_lift || 0) * 2.0 + 0.30;
            if (!proComboTag) {
              proComboTag = `🔗 Sinergi Penutup KPL: ${(pairData.win_rate * 100).toFixed(0)}% WR dg ${teammate.name}`;
            }
          }
        }

        if (hasEnemyDunshan) {
          if (
            (cand.hero_id === 175 && teammate.hero_id === 106) ||
            (cand.hero_id === 106 && teammate.hero_id === 175)
          ) {
            score += 0.65;
            proComboTag = '⚡ Chain CC: Hook Kui + Knockup S2 Xiao Qiao tembus Dunshan';
          }
        }
      }

      // Team Composition Radar Balancing (Frontline / CC gap)
      if (!isPrimaryOccupied) {
        if (frontline < 0.48 && (cand.primary_role === 'Tank' || cand.primary_role === 'Fighter')) {
          score += 0.35;
          if (!proComboTag) proComboTag = '🛡️ Melengkapi Frontline Durability Tim';
        } else if (cc < 0.48 && (cand.primary_role === 'Support' || cand.primary_role === 'Tank' || cand.primary_role === 'Mage')) {
          score += 0.30;
          if (!proComboTag) proComboTag = '⛓️ Melengkapi Rantai CC Lockdown Tim';
        }
      }
    }

    scoredCandidates.push({
      hero: cand,
      baseScore: cand.win_rate,
      finalScore: score,
      proComboTag,
      laneTag,
    });
  }

  // Softmax normalization over final scores
  const maxScore = Math.max(...scoredCandidates.map((c) => c.finalScore), 0);
  let expSum = 0;
  const expScores = scoredCandidates.map((c) => {
    const val = Math.exp(Math.min(50, c.finalScore - maxScore));
    expSum += val;
    return val;
  });

  const recommendations = scoredCandidates.map((c, idx) => ({
    hero: c.hero,
    probability: expSum > 0 ? expScores[idx] / expSum : 1 / scoredCandidates.length,
    choiceScore: c.finalScore,
    proComboTag: c.proComboTag,
    laneTag: c.laneTag,
  }));

  recommendations.sort((a, b) => b.probability - a.probability);

  // 7. Build Human-Readable Phase Strategy Summary for UI
  const ourVacantArr = Array.from(ourVacantLanes);
  const enemyVacantArr = Array.from(enemyVacantLanes);

  let phaseTitle = '';
  let phaseObjective = '';

  if (phaseId === 'BAN_PHASE_1') {
    if (isBlueSide) {
      phaseTitle = 'FASE BAN 1 (BLUE FIRST-PICK PREP)';
      if (activePlan === 'PLAN_B' && isPlanABanned) {
        phaseObjective = `⚠️ Plan A (${planAHero?.name}) DI-BAN lawan! AI otomatis pivot ke Plan B: ${planBHero?.name} (${planBHero?.primary_lane}). Fokus ban counter ${planBHero?.name} sekarang!`;
      } else if (plannedOpener) {
        phaseObjective = `Target First-Pick ${activePlan === 'PLAN_A' ? 'Plan A' : 'Opener'}: ${plannedOpener.name} (${plannedOpener.primary_lane}). Jangan ban hero ini — fokus ban hard counter-nya agar aman di B1! (Cadangan Plan B: ${planBHero?.name || 'Tersedia'})`;
      } else {
        phaseObjective = 'Amankan jalur untuk First-Pick S-Tier kita dengan mem-ban counter alaminya.';
      }
    } else {
      phaseTitle = 'FASE BAN 1 (RED COUNTER-OPENING)';
      if (activePlan === 'PLAN_B' && isPlanABanned) {
        phaseObjective = `⚠️ Plan A Red (${planAHero?.name}) di-ban! AI pivot ke Plan B: ${planBHero?.name}. Deny B1 Blue (${blueB1ThreatHero?.name || 'S-Tier'}) & amankan ${planBHero?.name}.`;
      } else if (blueB1ThreatHero) {
        phaseObjective = `Blue punya First-Pick B1! Wajib ban hero S-Tier terkuat (${blueB1ThreatHero.name}) atau ban counter dari rencana R1+R2 kita (${plannedOpener?.name || 'Core'}).`;
      } else {
        phaseObjective = 'Cegah Blue mendapatkan S-Tier Opener gratis di B1 dan amankan kombo R1+R2 kita.';
      }
    }
  } else if (phaseId === 'PICK_PHASE_1') {
    if (draftStep === 4) {
      phaseTitle = 'FASE PICK 1 — BLUE FIRST PICK (B1)';
      phaseObjective = plannedOpener
        ? `Ambil ${plannedOpener.name} sekarang (${activePlan === 'PLAN_B' ? 'Eksekusi Plan B' : 'Eksekusi Plan A'})! ${
            bannedOpenerCounters.length > 0
              ? `Counter utamanya (${bannedOpenerCounters.join(', ')}) sudah berhasil dibersihkan di Fase Ban 1.`
              : 'Hero pembuka prioritas tertinggi.'
          }`
        : 'Amankan hero Meta S-Tier paling fleksibel untuk membuka formasi.';
    } else {
      phaseTitle = `FASE PICK 1 — PEMBENTUKAN CORE (${ourVacantArr.join(', ')})`;
      phaseObjective = `Respon pick musuh (${enemyHeroes.map((e) => e.name).join(', ') || '-'}) dengan kombo sinergi KPL & isi lane kosong (${ourVacantArr.join(', ')}).`;
    }
  } else if (phaseId === 'BAN_PHASE_2') {
    phaseTitle = `FASE BAN 2 — PUTUS KOMBO & KUNCI LANE MUSUH`;
    phaseObjective = `Musuh tinggal butuh lane [${enemyVacantArr.join(' & ')}]. Ban hero meta di lane tersebut yang bisa kombo dengan (${enemyHeroes.map((e) => e.name).join(', ')}) atau meng-counter 3 hero kita!`;
  } else if (phaseId === 'PICK_PHASE_2') {
    phaseTitle =
      draftStep === 17
        ? 'FASE PICK 2 — RED FINAL COUNTER-PICK (R5)'
        : `FASE PICK 2 — PENUTUP KOMPOSISI (${ourVacantArr.join(' & ')})`;
    phaseObjective = `Wajib isi sisa lane kosong kita [${ourVacantArr.join(' & ')}] sambil meng-counter formasi musuh (${enemyHeroes.map((e) => e.name).join(', ')}).`;
  } else {
    phaseTitle = 'DRAFT SELESAI — ANALISIS KOMPOSISI FINAL';
    phaseObjective = 'Seluruh 10 hero telah dipilih. Evaluasi kekuatan 6 dimensi taktis di bawah.';
  }

  const latencyMs = Math.round((performance.now() - t0) * 10) / 10;

  return {
    tacticalScores: {
      win_probability: Math.round(winProb * 100) / 100,
      early_game_pressure: Math.round(early * 100) / 100,
      cc_chain_lockdown: Math.round(cc * 100) / 100,
      frontline_durability: Math.round(frontline * 100) / 100,
      enemy_carry_shutdown: Math.round(shutdown * 100) / 100,
      draft_flexibility: Math.round(flex * 100) / 100,
    },
    recommendations,
    phaseStrategy: {
      phaseId,
      phaseTitle,
      phaseObjective,
      plannedOpener,
      activePlan,
      planAHero,
      planBHero,
      isPlanABanned,
      isPlanBBanned,
      candidateOpeners,
      bannedOpenerCounters,
      ourVacantLanes: ourVacantArr,
      enemyVacantLanes: enemyVacantArr,
    },
    latencyMs,
    isNeural: false,
  };
}
