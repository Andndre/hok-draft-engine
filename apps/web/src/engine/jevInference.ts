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

export interface JevPredictionResult {
  tacticalScores: TacticalVector;
  recommendations: Array<{
    hero: Hero;
    probability: number;
    choiceScore: number;
    proComboTag?: string;
    laneTag?: string;
  }>;
  latencyMs: number;
  isNeural: boolean;
}

function softmax(arr: Float32Array, mask: Float32Array): Float32Array {
  const result = new Float32Array(arr.length);
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (mask[i] === 0 && arr[i] > max) max = arr[i];
  }
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    if (mask[i] === 1) {
      result[i] = 0;
    } else {
      const exp = Math.exp(Math.min(50, arr[i] - max));
      result[i] = exp;
      sum += exp;
    }
  }
  if (sum > 0) {
    for (let i = 0; i < arr.length; i++) {
      result[i] /= sum;
    }
  }
  return result;
}

/**
 * Calculates occupied lanes in our team to prevent duplicate role recommendations (e.g. double Farm Lane)
 */
function analyzeLaneOccupancy(ourHeroes: Hero[]): {
  occupiedLanes: Set<Lane>;
  vacantLanes: Set<Lane>;
} {
  const ALL_LANES: Lane[] = ['Clash', 'Jungle', 'Mid', 'Farm', 'Roam'];
  const occupiedLanes = new Set<Lane>();

  ourHeroes.forEach((h) => {
    if (h.primary_lane) occupiedLanes.add(h.primary_lane);
  });

  const vacantLanes = new Set<Lane>(ALL_LANES.filter((l) => !occupiedLanes.has(l)));
  return { occupiedLanes, vacantLanes };
}

export async function runJevInference(
  ourHeroIds: number[],
  enemyHeroIds: number[],
  bannedHeroIds: number[],
  fearlessUnavailableIds: number[],
  isPickPhase: boolean,
  isBlueSide: boolean,
  heroes: Hero[]
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

  // 1. Team Lane Occupancy Analysis (Fixes duplicate Farm Lane issue)
  const { occupiedLanes, vacantLanes } = analyzeLaneOccupancy(ourHeroes);

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

  // Base traits & tactical dimensions calculation
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

    // Direct Kurohiko Counter Advantage
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

  // 3. Score every available candidate with external KPL pro synergies & lane vacancy
  const scoredCandidates: Array<{
    hero: Hero;
    baseScore: number;
    finalScore: number;
    proComboTag?: string;
    laneTag?: string;
  }> = [];

  const proPairs = synergyDb?.pairs || {};
  const dunshanPairs = synergyDb?.dunshan_pair_counters || {};
  const hasEnemyDunshan = enemyHeroes.some((e) => e.hero_id === 509 || e.name.toLowerCase() === 'dunshan');

  for (let i = 0; i < heroes.length; i++) {
    if (maskArr[i] === 1) continue;

    const cand = heroes[i];
    let score = (cand.win_rate - 0.48) * 2.5;

    // A. Direct Counter Bonus
    for (const eh of enemyHeroes) {
      if (cand.counters.some((c) => c.target_id === eh.hero_id)) {
        score += 0.35;
      }
    }

    // B. LANE VACANCY / SATURATION CONSTRAINT:
    // If candidate's primary lane is already filled in our team, apply heavy saturation penalty!
    let laneTag: string | undefined = undefined;
    const isPrimaryOccupied = occupiedLanes.has(cand.primary_lane);
    const canFlexToVacant = cand.lanes.some((l) => vacantLanes.has(l));

    if (ourHeroes.length > 0) {
      if (!isPrimaryOccupied) {
        // Fills a vacant lane (e.g. Mid, Jungle, Clash when Farm is already picked)
        score += 0.45;
        laneTag = `Isi ${cand.primary_lane}`;
      } else if (canFlexToVacant) {
        // Primary is taken, but hero is versatile enough to flex into an empty lane
        score -= 0.10;
        laneTag = `Flex ${cand.lanes.find((l) => vacantLanes.has(l))}`;
      } else {
        // Saturated lane! (e.g. another Farm marksman when Farm is already picked)
        score -= 0.90; // Heavy penalty: pushes duplicate farm heroes far down the list
        laneTag = `${cand.primary_lane} Sudah Ada`;
      }
    }

    // C. EMPIRICAL KPL PRO SYNERGY & CHAIN CC COMBOS:
    let proComboTag: string | undefined = undefined;
    for (const teammate of ourHeroes) {
      const p1 = Math.min(cand.hero_id, teammate.hero_id);
      const p2 = Math.max(cand.hero_id, teammate.hero_id);
      const pairKey = `${p1}_${p2}`;

      if (proPairs[pairKey]) {
        const pairData = proPairs[pairKey];
        const lift = pairData.synergy_lift || 0;
        const matches = pairData.matches || 0;

        if (matches >= 20 && pairData.win_rate >= 0.50) {
          score += lift * 2.0 + 0.20;
          proComboTag = `KPL Pro: +${(pairData.win_rate * 100).toFixed(0)}% WR dg ${teammate.name} (${matches} Match)`;
        }
      }

      // Check anti-Dunshan combo pairs
      if (hasEnemyDunshan) {
        if (dunshanPairs[pairKey]) {
          const dData = dunshanPairs[pairKey];
          score += 0.45;
          proComboTag = `Counter Dunshan: ${cand.name} + ${teammate.name} (${(dData.win_rate_vs_dunshan * 100).toFixed(0)}% WR KPL)`;
        } else if (
          (cand.hero_id === 175 && teammate.hero_id === 106) ||
          (cand.hero_id === 106 && teammate.hero_id === 175)
        ) {
          // Kui + Xiao Qiao specific chain CC vs Dunshan
          score += 0.55;
          proComboTag = 'Chain CC: Hook Kui + Knockup S2 Xiao Qiao tembus Dunshan';
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
    recommendations: recommendations.slice(0, 10),
    latencyMs,
    isNeural: false,
  };
}
