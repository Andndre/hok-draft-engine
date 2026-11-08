import * as ort from 'onnxruntime-web';
import { Hero, TacticalVector } from '../types';
import { loadOnnxModelBuffer } from './r2ModelLoader';

// Configure ONNX Runtime Web WASM paths
ort.env.wasm.numThreads = 2;
ort.env.wasm.simd = true;

let inferenceSession: ort.InferenceSession | null = null;
let sessionInitPromise: Promise<ort.InferenceSession> | null = null;

export async function getInferenceSession(): Promise<ort.InferenceSession> {
  if (inferenceSession) return inferenceSession;
  if (sessionInitPromise) return sessionInitPromise;

  sessionInitPromise = (async () => {
    const buffer = await loadOnnxModelBuffer();
    const session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    inferenceSession = session;
    console.log('[JevEngine] ONNX Runtime Web session initialized successfully.');
    return session;
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
  const session = await getInferenceSession();

  const idToIndex = new Map<number, number>();
  heroes.forEach((h, idx) => idToIndex.set(h.hero_id, idx));

  // Tensors preparation:
  // our_picks: [1, 5]
  const ourPicksArr = new BigInt64Array(5).fill(120n);
  ourHeroIds.slice(0, 5).forEach((hid, i) => {
    const idx = idToIndex.get(hid);
    if (idx !== undefined) ourPicksArr[i] = BigInt(idx);
  });

  // enemy_picks: [1, 5]
  const enemyPicksArr = new BigInt64Array(5).fill(120n);
  enemyHeroIds.slice(0, 5).forEach((hid, i) => {
    const idx = idToIndex.get(hid);
    if (idx !== undefined) enemyPicksArr[i] = BigInt(idx);
  });

  // bans: [1, 10]
  const bansArr = new BigInt64Array(10).fill(120n);
  bannedHeroIds.slice(0, 10).forEach((hid, i) => {
    const idx = idToIndex.get(hid);
    if (idx !== undefined) bansArr[i] = BigInt(idx);
  });

  // unavailable_mask: [1, 120]
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

  // meta_info: [1, 3] -> [phase, side, pick_idx]
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
  const logitsTensor = results['choice_logits'];
  const scoresTensor = results['tactical_scores'];

  const rawLogits = logitsTensor.data as Float32Array;
  const rawScores = scoresTensor.data as Float32Array;

  const probs = softmax(rawLogits, maskArr);

  const tacticalScores: TacticalVector = {
    win_probability: rawScores[0] ?? 0.5,
    early_game_pressure: rawScores[1] ?? 0.5,
    cc_chain_lockdown: rawScores[2] ?? 0.5,
    frontline_durability: rawScores[3] ?? 0.5,
    enemy_carry_shutdown: rawScores[4] ?? 0.5,
    draft_flexibility: rawScores[5] ?? 0.5,
  };

  // Build sorted recommendations
  const ranked: Array<{ hero: Hero; probability: number; choiceScore: number }> = [];
  for (let i = 0; i < heroes.length; i++) {
    if (maskArr[i] === 0) {
      const prob = probs[i];
      ranked.push({
        hero: heroes[i],
        probability: prob,
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
  };
}
