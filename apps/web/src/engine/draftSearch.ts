/**
 * @file draftSearch.ts
 * @description Mesin pencarian Minimax Alpha-Beta untuk simulasi draft turnamen Honor of Kings (HoK Global).
 *
 * Menggunakan pendekatan game theory zero-sum:
 * - Iterative Deepening (Depth 1 sampai Depth 4) dengan batas waktu default 1.500 ms per aksi
 *   (`MAX_SEARCH_BUDGET_MS`). Jalur advisor boleh meminta anggaran lebih panjang hingga
 *   `MAX_ADVISOR_BUDGET_MS` dengan `allowExtendedBudget: true`; AI lawan tidak pernah.
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
  isOpenerPickSlot,
  isRiskyOpener,
  oppositeSide,
} from './draftRules';
import type { DraftContext, DraftPosition, DraftAction, Side } from './draftRules';
import {
  evaluateTacticalScores,
  evaluateEnemyCounterExposure,
  computeTournamentBaseQuality,
  computeOpenerPriorityScore,
  kplPresenceOf,
  runTournamentInference,
} from './tournamentInference';
import type { TournamentRecommendation } from './tournamentInference';

/** Konteks pencarian Minimax untuk AI lawan */
export interface SearchContext extends DraftContext {
  synergy: TournamentDataset['synergy'];
  aiSide: Side;
  aiPlan: { a: number | null; b: number | null };
}

/**
 * Nilai solver untuk satu kandidat root.
 *
 * `value` adalah nilai posisi dari sudut pandang sisi yang sedang bergiliran
 * (positif = bagus). `depth` menyatakan berapa ply di bawah root yang dipakai
 * untuk menghitungnya: nilai dari pass "kepala" (kandidat yang benar-benar
 * dipertimbangkan alpha-beta pada kedalaman penuh) lebih dalam daripada nilai
 * pass "ekor" (kandidat di luar lebar cabang, dihitung 1 ply dengan balasan
 * lawan terbaik). Nilai dengan `depth` lebih dalam selalu lebih otoritatif.
 */
export interface RootCandidateValue {
  heroId: number;
  value: number;
  /** Ply di bawah root yang dipakai untuk menghitung nilai ini. */
  depth: number;
  /**
   * Blok nilai:
   * - `head` = kandidat yang benar-benar diperhitungkan alpha-beta pada
   *   kedalaman penuh (nilai paling otoritatif, selalu didahulukan).
   * - `tail` = kandidat di luar lebar cabang, dihitung dangkal (1 ply) supaya
   *   seluruh daftar tetap berurutan menurut mesin.
   */
  tier: 'head' | 'tail';
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
  /**
   * Nilai solver per kandidat root — dasar pengurutan SELURUH daftar
   * rekomendasi, bukan cuma #1 yang dipromosikan.
   * Hanya diisi ketika `orderCandidates` dinyalakan (jalur advisor).
   */
  rootValues?: RootCandidateValue[];
}

/**
 * Batas anggaran pencarian DEFAULT (ms) — dipakai AI lawan dan semua pemanggil lain.
 * Angka ini adalah invarian permainan latihan: AI lawan tidak boleh tiba-tiba berpikir
 * lebih lama hanya karena advisor mendapat anggaran lebih besar.
 */
export const MAX_SEARCH_BUDGET_MS = 1500;

/**
 * Plafon anggaran KHUSUS jalur advisor (ms).
 *
 * Product owner secara eksplisit tidak peduli latensi pada jalur ADVISOR
 * ("rekomendasi harus langkah terbaik; kecepatan tidak penting"), jadi advisor
 * boleh meminta pencarian lebih dalam daripada AI lawan. Ini TIDAK mengubah
 * default: `budgetMs` tetap dijepit ke `MAX_SEARCH_BUDGET_MS` kecuali pemanggil
 * menulis `allowExtendedBudget: true` secara sadar.
 */
export const MAX_ADVISOR_BUDGET_MS = 8000;

/**
 * Batas kedalaman pencarian di akar "opener buta" (pick pertama, kedua sisi
 * masih tanpa pick sama sekali).
 *
 * Di titik itu lineup yang dinilai subtree solver untuk balasan lawan adalah
 * SPEKULASI — komposisi hipotetis yang dipilih solver sendiri, bukan pilihan
 * lawan yang nyata. Yang terukur adalah rekam jejak first-pick KPL.
 *
 * Aturan hierarki bukti (AGENTS.md §4.H): bukti terukur tidak boleh dikalahkan
 * sinyal yang lebih lemah. Maka di akar ini pencarian dipotong menjadi
 * "pick kita + balasan lawan pertama", dan yang menentukan = rekam jejak
 * pembuka + posisi sesudah balasan pertama. Di slot lain (lawan sudah punya
 * pick) pencarian tetap penuh.
 */
export const BLIND_OPENER_MAX_DEPTH = 1;

/** Opsi konfigurasi pencarian Minimax */
export interface SearchOptions {
  maxDepth?: number;
  width?: number;
  budgetMs?: number;
  /**
   * Mengizinkan `budgetMs` melewati `MAX_SEARCH_BUDGET_MS` hingga
   * `MAX_ADVISOR_BUDGET_MS`. Hanya jalur advisor yang boleh menyalakannya:
   * AI lawan harus tetap berhenti di 1.500 ms agar permainan tetap responsif.
   */
  allowExtendedBudget?: boolean;
  now?: () => number;
  /**
   * Pengali kredit counter di dalam evaluasi posisi.
   * Default 1 (penuh). Nilai < 1 dipakai untuk menguji dampaknya pada pick buta,
   * di mana komposisi lawan belum diketahui sehingga kredit counter spekulatif.
   */
  counterWeight?: number;
  /**
   * Menghitung nilai solver PER KANDIDAT (bukan hanya movements terbaik), supaya
   * daftar rekomendasi yang dilihat user bisa diurutkan oleh game theory —
   * bukan sekadar #1 yang dipromosikan.
   *
   * Opt-in: hanya jalur advisor yang menyalakannya. Jalur lawan AI tidak pernah,
   * jadi tidak ada biaya tambahan dan invarian anggaran 1.500 ms tetap utuh.
   */
  orderCandidates?: boolean;
  /**
   * Kedalaman pass "ekor" — kandidat di luar lebar cabang dievaluasi pada
   * kedalaman ini (1 ply: pick kita + balasan lawan terbaik). Default 1.
   */
  orderTailDepth?: number;
  /**
   * Batas jumlah kandidat ekor yang dievaluasi. Default: semua kandidat legal.
   * Batas ini hanya memangkas Pass Ekor; Pass Kepala (kandidat yang benar-benar
   * dihitung alpha-beta) tidak pernah dipangkas.
   */
  orderTailLimit?: number;
}

/**
 * Menyaring dan mengurutkan kandidat hero legal untuk giliran saat ini.
 * Memprioritaskan hero yang mengisi lane kosong tim untuk mencegah duplikasi role di turnamen.
 */
export function rankedCandidates(position: DraftPosition, context: SearchContext) {
  const turn = getDraftTurn(position.step, context.format);
  if (turn.isComplete) return [];

  const activeBans = (context.format === 'ranked' && turn.action === 'ban')
    ? position.bans[turn.side]
    : [...position.bans.blue, ...position.bans.red];

  const inferenceResult = runTournamentInference(
    position.picks[turn.side],
    position.picks[oppositeSide(turn.side)],
    activeBans,
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
    context.format,
    context.isUltimateBattle,
    context.rankedBanCount
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
  return pickPhaseCandidates(legalCandidates, ourHeroes, kplLaneRates);
}

/**
 * Kandidat yang layak dipilih pada fase pick.
 *
 * Prioritasnya:
 * 1. Kandidat yang mengisi LANE UTAMA yang belum terisi (dan lolos aturan
 *    integritas komposisi) — inilah yang terlihat pemain di papan.
 * 2. Kandidat yang mengisi lane utama meski aturan integritas menolak.
 * 3. Kandidat yang menambah okupansi lane menurut model integritas (boleh flex:
 *    Bai Qi main Jungle di 26% match KPL).
 * 4. Semua kandidat sebagai fallback.
 *
 * Fungsi ini dipakai bersama oleh mesin (`rankedCandidates`) dan UI, supaya
 * rekomendasi yang dilihat pengguna persis kandidat yang benar-benar consider
 * mesin — bukan sheet mentah yang bisa menyebut hero yang lane-nya sudah penuh.
 */
export function pickPhaseCandidates(
  candidates: TournamentRecommendation[],
  ourHeroes: Hero[],
  kplLaneRates: Record<string, any> | undefined
): TournamentRecommendation[] {
  if (ourHeroes.length === 0) return candidates;
  const baseIntegrity = evaluateTeamCompositionIntegrity(ourHeroes, kplLaneRates);
  const healthyLaneFittingCandidates = candidates.filter((r) => {
    const nextIntegrity = evaluateTeamCompositionIntegrity([...ourHeroes, r.hero], kplLaneRates);
    return (
      nextIntegrity.laneState.occupiedLanes.size === ourHeroes.length + 1 &&
      nextIntegrity.displacedSupports.length <= baseIntegrity.displacedSupports.length &&
      nextIntegrity.duplicateRoamSupports <= baseIntegrity.duplicateRoamSupports &&
      !nextIntegrity.isFullCompWithoutMagicDamage
    );
  });
  // LANE UTAMA yang belum terisi. Inilah yang terlihat pemain di papan: lima lane
  // berbeda. Model integritas boleh mem-fleks Bai Qi (Clash) ke Jungle karena dia
  // main Jungle di 26% match KPL — tapi papan tetap menampilkan "Clash", jadi tim
  // terlihat seperti dua Clash tanpa jungler. Karena itu lane utama didahulukan,
  // dan flex hanya dipakai kalau tidak ada kandidat lane utama yang tersisa.
  const coveredPrimaryLanes = new Set(ourHeroes.map((h) => h.primary_lane));
  const fillsMissingPrimaryLane = (hero: Hero) => !coveredPrimaryLanes.has(hero.primary_lane);

  const healthyPrimaryLaneCandidates = healthyLaneFittingCandidates.filter((r) =>
    fillsMissingPrimaryLane(r.hero)
  );
  if (healthyPrimaryLaneCandidates.length > 0) {
    return healthyPrimaryLaneCandidates;
  }

  const primaryLaneCandidates = candidates.filter((r) => fillsMissingPrimaryLane(r.hero));
  if (primaryLaneCandidates.length > 0) {
    return primaryLaneCandidates;
  }

  if (healthyLaneFittingCandidates.length > 0) {
    return healthyLaneFittingCandidates;
  }

  const laneFittingCandidates = candidates.filter(
    (r) => analyzeLaneOccupancy([...ourHeroes, r.hero], kplLaneRates).occupiedLanes.size === ourHeroes.length + 1
  );

  return laneFittingCandidates.length > 0 ? laneFittingCandidates : candidates;
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
/**
 * Opsi evaluasi posisi.
 * - `counterWeight`: pengali bonus counter langsung (1 = penuh, 0 = diabaikan).
 *   Dipakai untuk mengukur dampak kredit counter pada pick buta: saat first pick,
 *   komposisi lawan belum diketahui, sehingga kredit counter terhadap hero yang
 *   baru "direspons"(search) bersifat spekulatif.
 */
export interface PositionEvaluationOptions {
  counterWeight?: number;
}

export function evaluatePosition(
  position: DraftPosition,
  context: SearchContext,
  perspective: Side,
  options: PositionEvaluationOptions = {}
): number {
  const counterWeight = options.counterWeight ?? 1;
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

    // 1. Kualitas dasar hero di turnamen dikurangi penalti paparan counter musuh.
    //    Hero yang dipilih di slot PEMBUKA (B1 biru, R1 + R2 merah) dinilai
    //    dengan aturan opener yang sama seperti sheet: rekam jejak first-pick
    //    terukur (KPL), kredibilitas meta, dan penalti carry statis.
    //
    //    Tanpa aturan ini solver cenderung memilih pick "aman" (tank/support)
    //    di B1 buta: minimax melihat balasan lawan, bukan meta pembuka yang
    //    terukur — hasilnya B1 merekomendasikan tank, bukan opener meta
    //    (Liang, Dun, Ao'yin, Augran, Marco Polo, Haya, Lady Sun).
    const openerHeroIds = new Set<number>();
    position.picks[side].forEach((id, index) => {
      if (isOpenerPickSlot(side, index)) openerHeroIds.add(id);
    });

    let totalScore = ourTeam.reduce((sum, hero) => {
      const exposure = exposures.get(hero.hero_id)!;
      let baseQuality = computeTournamentBaseQuality(
        hero,
        b1Openers,
        position.step,
        exposure.synergyMultiplier
      );
      if (openerHeroIds.has(hero.hero_id)) {
        const openerInfo = kplPresenceOf(hero.hero_id, b1Openers);
        const hasOpenerCredibility =
          (openerInfo?.b1 ?? 0) >= 90 || (openerInfo?.r1r2 ?? 0) >= 180;
        // Carry immobile tidak boleh jadi pembuka: sheet membuangnya dari daftar
        // B1, jadi di evaluator ia tidak dapat bonus opener sama sekali.
        if (hasOpenerCredibility && !isRiskyOpener(hero)) {
          baseQuality +=
            computeOpenerPriorityScore(hero, b1Openers, side === 'blue', context.onlyGlobal) *
            0.45 *
            exposure.synergyMultiplier;
        }
      }
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
      counterBonus(ourTeam, enemyTeam) * counterWeight -
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
        counterBonus([hero], enemyTeam) * counterWeight -
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
  // Anggaran waktu: default tetap MAX_SEARCH_BUDGET_MS. Plafon lebih tinggi hanya
  // berlaku bila pemanggil secara eksplisit meminta anggaran panjang untuk advisor
  // (product owner tidak peduli latensi di jalur itu) — AI lawan tidak pernah
  // menyalakan flag ini, jadi invarian 1.500 ms-nya utuh.
  const budgetCeilingMs = options.allowExtendedBudget === true ? MAX_ADVISOR_BUDGET_MS : MAX_SEARCH_BUDGET_MS;
  const timeBudgetMs = Math.min(budgetCeilingMs, Math.max(0, options.budgetMs ?? MAX_SEARCH_BUDGET_MS));
  const deadline = startTime + timeBudgetMs;
  const counterWeight = options.counterWeight ?? 1;

  const remainingActions = getDraftSequence(context.format).length - position.step;
  const maxSearchDepth = Math.min(4, remainingActions, Math.max(1, options.maxDepth ?? 4));
  const branchWidth = Math.min(8, Math.max(1, options.width ?? 8));

  const rootTurn = getDraftTurn(position.step, context.format);
  const rootSide = rootTurn.side;
  const allRootCandidates = rankedCandidates(position, context);
  const rootCandidates = allRootCandidates.slice(0, branchWidth);
  const primaryCandidate = rootCandidates[0];

  // Akar pembuka buta: pick pertama saat kedua sisi belum punya pick. Di sini
  // subtree balasan lawan hanya spekulasi, jadi pencarian dipotong (lihat
  // BLIND_OPENER_MAX_DEPTH). Di slot lain pencarian tetap kedalaman penuh.
  const blindOpenerRoot =
    rootTurn.action === 'pick' &&
    position.picks[rootSide].length === 0 &&
    position.picks[oppositeSide(rootSide)].length === 0;
  const effectiveMaxDepth = blindOpenerRoot
    ? Math.min(maxSearchDepth, BLIND_OPENER_MAX_DEPTH)
    : maxSearchDepth;

  // Pengurutan daftar oleh solver — opt-in, hanya jalur advisor.
  const orderCandidates = options.orderCandidates === true;
  const orderTailDepth = Math.max(1, Math.min(4, options.orderTailDepth ?? 1));
  const orderTailLimit = Math.max(0, options.orderTailLimit ?? Number.MAX_SAFE_INTEGER);

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

  /**
   * Rekaman nilai kandidat root untuk iterasi deepening yang sedang berjalan,
   * plus rekaman terbaik yang sudah lengkap (dipakai untuk Pass Kepala).
   */
  let rootIterationValues = new Map<number, number>();
  let bestRootValues: RootCandidateValue[] = [];

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
        valueCache.set(posKey, evaluatePosition(pos, context, rootSide, { counterWeight }));
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
    // Node root adalah node yang dipanggil dengan objek posisi awal — tidak
    // pernah muncul lagi di pohon, jadi penandanya unik.
    const isRootNode = pos === position;
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

      // Rekaman nilai kandidat root (Pass Kepala). Nilai kandidat yang ter-cutoff
      // adalah batas atas — wajar untuk alpha-beta; yang dijamin: kandidat dengan
      // nilai tertinggi = keputusan solver dan nilainya eksak.
      if (orderCandidates && isRootNode) {
        rootIterationValues.set(candidate.hero.hero_id, childResult.value);
      }

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
  for (let currentDepth = 1; currentDepth <= effectiveMaxDepth; currentDepth++) {
    // Rekaman di-reset per iterasi: hanya iterasi yang SELESAI penuh yang layak
    // dipromosikan (kalau timeout, rekaman terakhir tidak lengkap).
    rootIterationValues = new Map();
    try {
      const searchResult = visitNode(position, currentDepth, -Infinity, Infinity);
      decision.heroId = searchResult.line[0]?.heroId ?? decision.heroId;
      decision.principalVariation = searchResult.line;
      decision.completedDepth = currentDepth;
      decision.engineKind = 'search';
      if (orderCandidates && rootIterationValues.size === rootCandidates.length) {
        bestRootValues = rootCandidates.map((candidate) => ({
          heroId: candidate.hero.hero_id,
          value: rootIterationValues.get(candidate.hero.hero_id) ?? -Infinity,
          depth: currentDepth - 1,
          tier: 'head',
        }));
      }
    } catch (err) {
      if (err === timeoutSymbol) {
        // Waktu habis: pertahankan hasil kedalaman terdalam yang berhasil diselesaikan
        break;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // PASS EKOR: kandidat di luar lebar cabang tetap dinilai solver, supaya
  // SELURUH daftar rekomendasi bisa diurutkan oleh game theory — bukan hanya
  // 8 kandidat teratas. Nilainya dihitung pada `orderTailDepth` ply dengan
  // JENDELA PENUH (tidak ada pruning): pick kita + balasan lawan terbaik.
  //
  // Sadar-deadline: kalau anggaran habis di tengah, nilai yang sudah terkumpul
  // tetap dipakai (pengurutan parsial sah) dan tidak ada yang hilang.
  // ---------------------------------------------------------------------------
  if (orderCandidates) {
    const headIds = new Set(bestRootValues.map((entry) => entry.heroId));
    const tailCandidates = allRootCandidates
      .filter((candidate) => !headIds.has(candidate.hero.hero_id))
      .slice(0, orderTailLimit);
    for (const candidate of tailCandidates) {
      try {
        checkTimeBudget();
        const draftAction: DraftAction = {
          side: rootTurn.side,
          action: rootTurn.action,
          heroId: candidate.hero.hero_id,
        };
        const nextPosition = applyDraftAction(position, draftAction, context, context.format);
        const childResult = visitNode(nextPosition, orderTailDepth, -Infinity, Infinity);
        bestRootValues.push({
          heroId: candidate.hero.hero_id,
          value: childResult.value,
          depth: orderTailDepth,
          tier: 'tail',
        });
      } catch (err) {
        if (err === timeoutSymbol) break; // nilai parsial tetap sah
        throw err;
      }
    }

    // Urutan nilai: blok `head` lebih otoritatif dan selalu didahulukan, lalu
    // nilai tertinggi, lalu urutan kandidat root asli sebagai pemutus seri.
    const rootOrder = new Map(allRootCandidates.map((candidate, index) => [candidate.hero.hero_id, index]));
    decision.rootValues = bestRootValues.toSorted(
      (a, b) =>
        (a.tier === b.tier ? 0 : a.tier === 'head' ? -1 : 1) ||
        (b.value - a.value) ||
        ((rootOrder.get(a.heroId) ?? Number.MAX_SAFE_INTEGER) - (rootOrder.get(b.heroId) ?? Number.MAX_SAFE_INTEGER)),
    );
  }

  decision.elapsedMs = Math.round(getTimestamp() - startTime);
  return decision;
}
