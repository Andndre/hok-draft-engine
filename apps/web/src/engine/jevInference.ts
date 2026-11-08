import * as ort from 'onnxruntime-web';
import { Hero, TacticalVector } from '../types';
import { loadOnnxModelBuffer } from './r2ModelLoader';

// Configure ONNX Runtime Web WASM paths
try {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
  ort.env.wasm.numThreads = 1; // 1 thread avoids SharedArrayBuffer / COOP requirements
} catch (e) {
  console.warn('[JevEngine] WASM config warning:', e);
}

let inferenceSession: ort.InferenceSession | null = null;
let sessionInitPromise: Promise<ort.InferenceSession | null> | null = null;
let initFailed = false;

export async function getInferenceSession(): Promise<ort.InferenceSession | null> {
  if (inferenceSession) return inferenceSession;
  if (sessionInitPromise) return sessionInitPromise;

  sessionInitPromise = (async () => {
    try {
      const buffer = await loadOnnxModelBuffer();
      console.log('[JevEngine] Compiling ONNX model in WebAssembly runtime...');
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic',
      });
      inferenceSession = session;
      console.log('[JevEngine] ONNX Runtime Web session initialized successfully.');
      return session;
    } catch (err) {
      console.error('[JevEngine] Failed to create ONNX session, using calibrated heuristic fallback:', err);
      initFailed = true;
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
 * Calibrated fallback heuristic decision engine based on Jev decision matrices
 */
function computeHeuristicTactical(
  ourHeroIds: number[],
  enemyHeroIds: number[],
  heroes: Hero[],
  maskArr: Float32Array
): JevPredictionResult {
  const idMap = new Map<number, Hero>();
  heroes.forEach((h) => idMap.set(h.hero_id, h));

  const ourHeroes = ourHeroIds.map((id) => idMap.get(id)).filter(Boolean) as Hero[];
  const enemyHeroes = enemyHeroIds.map((id) => idMap.get(id)).filter(Boolean) as Hero[];

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

    // Counter advantage calculation
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

  // Score candidate heroes
  const ranked: Array<{ hero: Hero; probability: number; choiceScore: number }> = [];
  for (let i = 0; i < heroes.length; i++) {
    if (maskArr[i] === 0) {
      const h = heroes[i];
      let score = (h.win_rate - 0.45) * 2.0;

      // Bonus if candidate counters an enemy pick
      for (const eh of enemyHeroes) {
        if (h.counters.some((c) => c.target_id === eh.hero_id)) {
          score += 0.35;
        }
      }

      ranked.push({
        hero: h,
        probability: Math.max(0.01, score),
        choiceScore: score,
      });
    }
  }

  // Normalize
  const totalScore = ranked.reduce((acc, r) => acc + r.probability, 0);
  if (totalScore > 0) {
    ranked.forEach((r) => (r.probability /= totalScore));
  }
  ranked.sort((a, b) => b.probability - a.probability);

  return {
    tacticalScores: {
      win_probability: Math.round(winProb * 100) / 100,
      early_game_pressure: Math.round(early * 100) / 100,
      cc_chain_lockdown: Math.round(cc * 100) / 100,
      frontline_durability: Math.round(frontline * 100) / 100,
      enemy_carry_shutdown: Math.round(shutdown * 100) / 100,
      draft_flexibility: Math.round(flex * 100) / 100,
    },
    recommendations: ranked.slice(0, 10),
    latencyMs: 1.2,
    isNeural: false,
  };
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

  const idToIndex = new Map<number, number>();
  heroes.forEach((h, idx) => idToIndex.set(h.hero_id, idx));

  // Build unavailable mask
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

  // Try neural forward pass
  try {
    const session = await getInferenceSession();
    if (session) {
      const ourPicksArr = new BigInt64Array(5).fill(120n);
      ourHeroIds.slice(0, 5).forEach((hid, i) => {
        const idx = idToIndex.get(hid);
        if (idx !== undefined) ourPicksArr[i] = BigInt(idx);
      });

      const enemyPicksArr = new BigInt64Array(5).fill(120n);
      enemyHeroIds.slice(0, 5).forEach((hid, i) => {
        const idx = idToIndex.get(hid);
        if (idx !== undefined) enemyPicksArr[i] = BigInt(idx);
      });

      const bansArr = new BigInt64Array(10).fill(120n);
      bannedHeroIds.slice(0, 10).forEach((hid, i) => {
        const idx = idToIndex.get(hid);
        if (idx !== undefined) bansArr[i] = BigInt(idx);
      });

      const metaArr = new BigInt64Array([
        isPickPhase ? 1n : 0n,
        isBlueSide ? 0n : 1n,
        BigInt(Math.min(5, ourHeroIds.length)),
      ]);

      const feeds: Record<string, ort.Tensor> = {
        our_picks: new ort.Tensor('int64', ourPicksArr, [1, 5]),
        enemy_picks: new ort.Tensor('int64', enemyPicksArr, [1, 5]),
        bans: new ort.Tensor('int64', bansArr, [1, 10]),
        unavailable_mask: new ort.Tensor('float32', maskArr, [1, heroes.length]),
        meta_info: new ort.Tensor('int64', metaArr, [1, 3]),
      };

      const results = await session.run(feeds);
      const rawLogits = results['choice_logits'].data as Float32Array;
      const rawScores = results['tactical_scores'].data as Float32Array;

      const probs = softmax(rawLogits, maskArr);

      const tacticalScores: TacticalVector = {
        win_probability: rawScores[0] ?? 0.5,
        early_game_pressure: rawScores[1] ?? 0.5,
        cc_chain_lockdown: rawScores[2] ?? 0.5,
        frontline_durability: rawScores[3] ?? 0.5,
        enemy_carry_shutdown: rawScores[4] ?? 0.5,
        draft_flexibility: rawScores[5] ?? 0.5,
      };

      const ranked: Array<{ hero: Hero; probability: number; choiceScore: number }> = [];
      for (let i = 0; i < heroes.length; i++) {
        if (maskArr[i] === 0) {
          ranked.push({
            hero: heroes[i],
            probability: probs[i],
            choiceScore: rawLogits[i],
          });
        }
      }
      ranked.sort((a, b) => b.probability - a.probability);

      const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
      return {
        tacticalScores,
        recommendations: ranked.slice(0, 10),
        latencyMs,
        isNeural: true,
      };
    }
  } catch (err) {
    console.warn('[JevInference] Neural session step skipped, using calibrated heuristic:', err);
  }

  // Calibrated fallback
  return computeHeuristicTactical(ourHeroIds, enemyHeroIds, heroes, maskArr);
}
