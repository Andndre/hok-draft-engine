/**
 * @file draftSearch.ts
 * @description Mesin pencarian Minimax Alpha-Beta untuk simulasi draft turnamen Honor of Kings (HoK Global).
 *
 * Menggunakan pendekatan game theory zero-sum:
 * - Iterative Deepening (Depth 1 sampai Depth 4) dengan batas waktu ketat 1.500 ms per aksi.
 * - Alpha-Beta Pruning dengan batas cabang (Width 8 kandidat teratas per node).
 * - Evaluasi posisi asimetris: Strength(Perspektif AI) - Strength(Perspektif Musuh).
 * - Deny Pick secara alami muncul karena jika AI mengambil hero kunci lawan, nilai tree musuh anjlok drastis.
 */

import type { Hero, TournamentDataset } from '../types';
import {
  analyzeLaneOccupancy,
  applyDraftAction,
  computeKplPairAdjustment,
  getDraftSequence,
  evaluateTeamCompositionIntegrity,
  getDraftTurn,
  isLegalHero,
  isRiskyOpener,
  oppositeSide,
} from './draftRules';
import type { DraftContext, DraftPosition, DraftAction, Side } from './draftRules';
import {
  evaluateTacticalScores,
  evaluateEnemyCounterExposure,
  computeTournamentBaseQuality,
  runTournamentInference,
} from './tournamentInference';

/** Konteks pencarian Minimax untuk AI lawan */
export interface SearchContext extends DraftContext {
  synergy: TournamentDataset['synergy'];
  aiSide: Side;
  aiPlan: { a: number | null; b: number | null };
}

/** Hasil keputusan pencarian AI beserta variasi utama (Principal Variation) */
export interface SearchDecision {
  heroId: number | null;
  engineKind: 'deterministic' | 'search';
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  principalVariation: DraftAction[];
  fallbackReason?: string;
}

/** Opsi konfigurasi pencarian Minimax */
export interface SearchOptions {
  maxDepth?: number;
  width?: number;
  budgetMs?: number;
  now?: () => number;
}

/**
 * Menyaring dan mengurutkan kandidat hero legal untuk giliran saat ini.
 * Memprioritaskan hero yang mengisi lane kosong tim untuk mencegah duplikasi role di turnamen.
 */
export function rankedCandidates(position: DraftPosition, context: SearchContext) {
  const turn = getDraftTurn(position.step, context.format);
  if (turn.isComplete) return [];

  const inferenceResult = runTournamentInference(
    position.picks[turn.side],
    position.picks[oppositeSide(turn.side)],
    [...position.bans.blue, ...position.bans.red],
    context.fearless[turn.side],
    turn.action === 'pick',
    turn.side === 'blue',
    context.heroes,
    position.step,
    turn.side === context.aiSide ? context.aiPlan.a : null,
    turn.side === context.aiSide ? context.aiPlan.b : null,
    context.onlyGlobal,
    context.synergy,
    context.fearless[oppositeSide(turn.side)],
    context.format
  );

  const legalCandidates = inferenceResult.recommendations.filter((r) =>
    isLegalHero(position, r.hero.hero_id, context, context.format)
  );

  // Pada fase ban, seluruh kandidat legal dapat dipertimbangkan
  if (turn.action === 'ban') {
    return legalCandidates;
  }

  // Pada fase pick, utamakan kandidat yang mengisi lane kosong tanpa memaksa Support keluar dari Roam
  const ourHeroes = context.heroes.filter((h) => position.picks[turn.side].includes(h.hero_id));
  const kplLaneRates = context.synergy?.hero_lane_rates;
  const baseIntegrity = evaluateTeamCompositionIntegrity(ourHeroes, kplLaneRates);
  const healthyLaneFittingCandidates = legalCandidates.filter((r) => {
    const nextIntegrity = evaluateTeamCompositionIntegrity([...ourHeroes, r.hero], kplLaneRates);
    return (
      nextIntegrity.laneState.occupiedLanes.size === ourHeroes.length + 1 &&
      nextIntegrity.displacedSupports.length <= baseIntegrity.displacedSupports.length &&
      nextIntegrity.duplicateRoamSupports <= baseIntegrity.duplicateRoamSupports &&
      !nextIntegrity.isFullCompWithoutMagicDamage
    );
  });
  if (healthyLaneFittingCandidates.length > 0) {
    return healthyLaneFittingCandidates;
  }

  const laneFittingCandidates = legalCandidates.filter(
    (r) => analyzeLaneOccupancy([...ourHeroes, r.hero], kplLaneRates).occupiedLanes.size === ourHeroes.length + 1
  );

  return laneFittingCandidates.length > 0 ? laneFittingCandidates : legalCandidates;
}

/**
 * Menghitung bonus sinergi duet empiris KPL antara dua hero.
 * Mensyaratkan minimal 20 match dan winrate >= 50% untuk bonus, serta penalti anti-sinergi berat.
 */
function pairBonus(heroA: Hero, heroB: Hero, context: SearchContext): number {
  const pairKey = `${Math.min(heroA.hero_id, heroB.hero_id)}_${Math.max(heroA.hero_id, heroB.hero_id)}`;
  const pairData = context.synergy.pairs?.[pairKey];
  return computeKplPairAdjustment(pairData, 2.2, 0.35);
}

/**
 * Menghitung akumulasi bonus counter langsung terhadap formasi musuh.
 */
function counterBonus(ourTeam: Hero[], enemyTeam: Hero[]): number {
  return ourTeam.reduce((sum, ourHero) => {
    const countersCount = enemyTeam.filter(
      (enemyHero) =>
        ourHero.counters.some((c) => c.target_id === enemyHero.hero_id) ||
        enemyHero.countered_by.some((c) => c.counter_id === ourHero.hero_id)
    ).length;
    return sum + countersCount * 0.5;
  }, 0);
}

/**
 * Evaluasi nilai posisi asimetris zero-sum:
 * Positional Value = Strength(Perspective) - Strength(Opponent)
 *
 * Nilai ini adalah skor heuristik evaluasi papan, bukan probabilitas kemenangan terkalibrasi.
 */
export function evaluatePosition(position: DraftPosition, context: SearchContext, perspective: Side): number {
  const heroesById = new Map<number, Hero>(context.heroes.map((h) => [h.hero_id, h]));
  const getTeamHeroes = (side: Side) =>
    position.picks[side].map((id) => heroesById.get(id)!).filter(Boolean);

  const kplLaneRates = context.synergy?.hero_lane_rates;

  const calculateTeamStrength = (side: Side): number => {
    const ourTeam = getTeamHeroes(side);
    const enemyTeam = getTeamHeroes(oppositeSide(side));
    const b1Openers = context.synergy?.b1_openers || {};

    const tacticalRadar = evaluateTacticalScores(ourTeam, enemyTeam);
    const integrity = evaluateTeamCompositionIntegrity(ourTeam, kplLaneRates);
    const laneCoverage = integrity.laneState.occupiedLanes.size;
    const exposures = new Map(
      ourTeam.map((h) => [h.hero_id, evaluateEnemyCounterExposure(h, enemyTeam, b1Openers)])
    );

    // 1. Kualitas dasar hero di turnamen dikurangi penalti paparan counter musuh
    let totalScore = ourTeam.reduce((sum, hero) => {
      const exposure = exposures.get(hero.hero_id)!;
      const baseQuality = computeTournamentBaseQuality(
        hero,
        b1Openers,
        position.step,
        exposure.synergyMultiplier
      );
      return sum + baseQuality - exposure.exposurePenalty;
    }, 0);

    // 2. Kontribusi 6 dimensi radar taktis (early, CC, frontline, shutdown, flexibility, utility)
    totalScore +=
      tacticalRadar.early_game_pressure +
      tacticalRadar.cc_chain_lockdown +
      tacticalRadar.frontline_durability +
      tacticalRadar.enemy_carry_shutdown +
      tacticalRadar.draft_flexibility +
      tacticalRadar.team_utility;

    // 3. Counter bonus, integritas role/lane (cegah Support dipaksa ke Mid/Clash), & penalti duplikasi lane
    totalScore +=
      counterBonus(ourTeam, enemyTeam) -
      (ourTeam.length - laneCoverage) * 2.5 -
      integrity.displacedSupports.length * 2.8 -
      integrity.duplicateRoamSupports * 1.8 -
      (integrity.isFullCompWithoutMagicDamage ? 1.5 : 0);

    // 4. Sinergi duet KPL antar-anggota tim (bonus diredam jika terkena counter, penalti anti-sinergi utuh)
    for (let i = 0; i < ourTeam.length; i++) {
      for (let j = i + 1; j < ourTeam.length; j++) {
        const multA = exposures.get(ourTeam[i].hero_id)!.synergyMultiplier;
        const multB = exposures.get(ourTeam[j].hero_id)!.synergyMultiplier;
        const combinedMultiplier = Math.min(multA, multB);
        const pb = pairBonus(ourTeam[i], ourTeam[j], context);
        totalScore += pb > 0 ? pb * combinedMultiplier : pb;
      }
    }

    // Jika tim sudah lengkap 5 hero, kembalikan skor langsung
    if (ourTeam.length === 5) {
      return totalScore;
    }

    // 5. Proyeksi potensi follow-up agar posisi pada fase ban awal tetap memiliki bobot terarah
    const projectedStep = side === 'blue' ? 4 : 5;
    const projectedPosition = { ...position, step: projectedStep };
    let bestPotentialFollowUp = -2.5;

    for (const hero of context.heroes) {
      if (!isLegalHero(projectedPosition, hero.hero_id, context)) continue;
      if (position.step <= 4 && isRiskyOpener(hero)) continue;
      if (analyzeLaneOccupancy([...ourTeam, hero], kplLaneRates).occupiedLanes.size !== ourTeam.length + 1) continue;

      const exposure = evaluateEnemyCounterExposure(hero, enemyTeam, b1Openers);
      const heroValue =
        computeTournamentBaseQuality(hero, b1Openers, projectedPosition.step, exposure.synergyMultiplier) +
        counterBonus([hero], enemyTeam) -
        exposure.exposurePenalty +
        ourTeam.reduce((sum, teammate) => sum + pairBonus(hero, teammate, context) * exposure.synergyMultiplier, 0);

      bestPotentialFollowUp = Math.max(bestPotentialFollowUp, heroValue);
    }

    return totalScore + bestPotentialFollowUp * 0.25;
  };

  return calculateTeamStrength(perspective) - calculateTeamStrength(oppositeSide(perspective));
}

/**
 * Menjalankan algoritma Minimax Alpha-Beta dengan Iterative Deepening.
 *
 * Fitur:
 * - Mengembalikan keputusan deterministik instan jika kehabisan waktu budget (1.500 ms).
 * - Menggunakan tabel transposisi (candidateCache & valueCache) untuk menghindari re-komputasi.
 * - Menyimpan Principal Variation (jalur urutan aksi terbaik kedua tim).
 */
export function searchDraft(
  position: DraftPosition,
  context: SearchContext,
  options: SearchOptions = {}
): SearchDecision {
  const getTimestamp = options.now ?? (() => performance.now());
  const startTime = getTimestamp();
  const timeBudgetMs = Math.min(1500, Math.max(0, options.budgetMs ?? 1500));
  const deadline = startTime + timeBudgetMs;

  const remainingActions = getDraftSequence(context.format).length - position.step;
  const maxSearchDepth = Math.min(4, remainingActions, Math.max(1, options.maxDepth ?? 4));
  const branchWidth = Math.min(8, Math.max(1, options.width ?? 8));

  const rootTurn = getDraftTurn(position.step, context.format);
  const rootSide = rootTurn.side;
  const rootCandidates = rankedCandidates(position, context).slice(0, branchWidth);
  const primaryCandidate = rootCandidates[0];

  const decision: SearchDecision = {
    heroId: primaryCandidate?.hero.hero_id ?? null,
    engineKind: 'deterministic',
    completedDepth: 0,
    nodes: 0,
    elapsedMs: 0,
    principalVariation: [],
  };

  if (!primaryCandidate) {
    return decision;
  }

  const timeoutSymbol = Symbol('minimax-search-timeout');
  const checkTimeBudget = () => {
    if (getTimestamp() >= deadline) {
      throw timeoutSymbol;
    }
  };

  const candidateCache = new Map<string, ReturnType<typeof rankedCandidates>>();
  const valueCache = new Map<string, number>();

  const buildPositionKey = (pos: DraftPosition): string =>
    `${pos.step}:${pos.picks.blue.join(',')}:${pos.picks.red.join(',')}:${pos.bans.blue.join(',')}:${pos.bans.red.join(',')}`;

  /**
   * Rekursi Alpha-Beta Minimax untuk evaluasi pohon draft
   */
  const visitNode = (
    pos: DraftPosition,
    depth: number,
    alpha: number,
    beta: number
  ): { value: number; line: DraftAction[] } => {
    checkTimeBudget();
    decision.nodes++;

    const posKey = buildPositionKey(pos);
    const currentTurn = getDraftTurn(pos.step, context.format);

    // Kondisi terminasi leaf: kedalaman habis atau draft selesai
    if (depth <= 0 || currentTurn.isComplete) {
      if (!valueCache.has(posKey)) {
        valueCache.set(posKey, evaluatePosition(pos, context, rootSide));
      }
      checkTimeBudget();
      return { value: valueCache.get(posKey)!, line: [] };
    }

    // Ambil kandidat dengan caching
    if (!candidateCache.has(posKey)) {
      candidateCache.set(posKey, rankedCandidates(pos, context).slice(0, branchWidth));
    }
    checkTimeBudget();

    const candidates = candidateCache.get(posKey)!;
    if (candidates.length === 0) {
      return { value: evaluatePosition(pos, context, rootSide), line: [] };
    }

    const isMaximizing = currentTurn.side === rootSide;
    let bestResult = {
      value: isMaximizing ? -Infinity : Infinity,
      line: [] as DraftAction[],
    };

    let currentAlpha = alpha;
    let currentBeta = beta;

    for (const candidate of candidates) {
      checkTimeBudget();

      const draftAction: DraftAction = {
        side: currentTurn.side,
        action: currentTurn.action,
        heroId: candidate.hero.hero_id,
      };

      const nextPosition = applyDraftAction(pos, draftAction, context, context.format);
      const childResult = visitNode(nextPosition, depth - 1, currentAlpha, currentBeta);

      if (isMaximizing) {
        if (childResult.value > bestResult.value) {
          bestResult = { value: childResult.value, line: [draftAction, ...childResult.line] };
        }
        currentAlpha = Math.max(currentAlpha, bestResult.value);
      } else {
        if (childResult.value < bestResult.value) {
          bestResult = { value: childResult.value, line: [draftAction, ...childResult.line] };
        }
        currentBeta = Math.min(currentBeta, bestResult.value);
      }

      // Alpha-Beta Cutoff (Pruning)
      if (currentBeta <= currentAlpha) {
        break;
      }
    }

    return bestResult;
  };

  candidateCache.set(buildPositionKey(position), rootCandidates);

  // Iterative Deepening: cari secara bertahap dari depth 1 sampai maxSearchDepth
  for (let currentDepth = 1; currentDepth <= maxSearchDepth; currentDepth++) {
    try {
      const searchResult = visitNode(position, currentDepth, -Infinity, Infinity);
      decision.heroId = searchResult.line[0]?.heroId ?? decision.heroId;
      decision.principalVariation = searchResult.line;
      decision.completedDepth = currentDepth;
      decision.engineKind = 'search';
    } catch (err) {
      if (err === timeoutSymbol) {
        // Waktu habis: pertahankan hasil kedalaman terdalam yang berhasil diselesaikan
        break;
      }
      throw err;
    }
  }

  decision.elapsedMs = Math.round(getTimestamp() - startTime);
  return decision;
}
