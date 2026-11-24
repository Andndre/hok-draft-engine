/**
 * @file advisorRanking.ts
 * @description Menyelaraskan urutan rekomendasi yang dilihat pengguna dengan evaluator
 * posisi yang sama dengan mesin Minimax.
 *
 * MASALAH YANG DIUKUR (41 posisi pick legal, `tests/sheetSearchAgreement.mjs`):
 * sheet heuristik dan solver depth-3 hanya cocok 8/41 (19,5%) posisi. Penyebabnya
 * bukan kandidat (sheet tetap sah), tapi **skala penilaian**: sheet memakai skor
 * per-hero (kualitas dasar + counter + duet + lane fit), sementara solver menilai
 * posisi setelah pick. Ketika kandidat sheet diurutkan ulang dengan evaluator posisi
 * 1-ply milik solver, kesesuaian naik ke 26/41 (63,4%).
 *
 * PRINSIP:
 * - Heuristik tetap jadi PENCEMBAR kandidat (dia punya alasan & konteks yang tidak
 *   dimiliki evaluator posisi).
 * - Game theory yang menentukan URUTAN. Satu sumber kebenaran untuk saran app dan
 *   untuk gerakan AI lawan.
 * - Urutan akhir memakai NILAI PER KANDIDAT dari pencarian itu sendiri
 *   (`searchDraft` dengan `orderCandidates`), bukan cuma #1 yang dipromosikan:
 *   `orderRecommendationsBySolver` mengurutkan seluruh daftar.
 * - Plan A/B yang dikunci pengguna tetap didahulukan: keputusan pengguna bukan
 *   tebakan mesin.
 * - `plannedOpener` hasil tebakan mesin TIDAK dipaksa jadi #1 — diukur, itu
 *   menurunkan kesesuaian dari 63,4% ke 4,9%.
 */
import type { Hero, DuetPackageOption, DraftFormat } from '../types';
import type { DraftPosition, DraftAction } from './draftRules';
import { applyDraftAction, getDraftTurn, getDoublePickWindow, oppositeSide, evaluateTeamCompositionIntegrity } from './draftRules';
import { evaluatePosition } from './draftSearch';
import type { SearchContext, RootCandidateValue } from './draftSearch';
import type { TournamentRecommendation } from './tournamentInference';

/** Lebar kandidat yang di-evaluasi ulang — sama dengan lebar cabang solver. */
export const ADVISOR_RERANK_WIDTH = 8;

/**
 * Jawaban solver untuk jalur advisor, disimpan di state `App.tsx` sebagai
 * `advisorDecision`. Bentuk ini sengaja kecil: UI hanya perlu hero yang dipilih
 * solver plus metadata pencarian untuk ditampilkan.
 */
export interface AdvisorDecision {
  heroId: number;
  engineKind: string;
  completedDepth: number;
  elapsedMs: number;
  /** Nilai solver per kandidat — dasar urutan seluruh daftar rekomendasi. */
  rootValues?: RootCandidateValue[];
  /** Variasi utama aksi (Principal Variation) dari pencarian Minimax */
  principalVariation?: DraftAction[];
}

/**
 * Status solver untuk UI: "mesin sedang menghitung" saat pencarian berjalan,
 * lalu siap / tidak tersedia.
 */
export interface SolverStatus {
  state: 'idle' | 'calculating' | 'ready' | 'fallback';
  /** Hero yang dipilih solver (null saat belum ada jawaban). */
  heroId?: number | null;
  /** Kedalaman pencarian yang selesai. */
  depth?: number;
  /** Durasi pencarian terakhir. */
  elapsedMs?: number;
  /** Plan A/B yang dikunci user (kalau ada) — tetap didahulukan. */
  lockedPlanHeroId?: number | null;
  /** Nilai per kandidat root dari solver jika tersedia */
  rootValues?: RootCandidateValue[];
  /** Variasi utama aksi (Principal Variation) dari pencarian Minimax */
  principalVariation?: DraftAction[];
}

/**
 * Mengurutkan SELURUH daftar rekomendasi menurut nilai solver.
 *
 * Berbeda dengan promosi sederhana #1, fungsi ini memakai nilai per kandidat
 * yang dikembalikan pencarian itu sendiri:
 * - Blok `head` (kandidat yang benar-benar dihitung alpha-beta pada kedalaman
 *   penuh) selalu didahulukan, diurutkan nilai tertinggi.
 * - Blok `tail` (kandidat di luar lebar cabang, dihitung 1 ply) menyusul,
 *   juga diurutkan nilai tertinggi.
 * - Kandidat tanpa nilai solver mengikuti dengan urutan relatif aslinya.
 *
 * Plan A/B yang dikunci pengguna tetap di posisi pertama: keputusan pengguna
 * mengalahkan tebakan mesin.
 */
export function orderRecommendationsBySolver(
  recommendations: TournamentRecommendation[],
  rootValues: RootCandidateValue[] | undefined | null,
  options: { lockedPlanHeroId?: number | null } = {}
): TournamentRecommendation[] {
  if (!rootValues || rootValues.length === 0) return recommendations;

  const bestByHero = new Map<number, RootCandidateValue>();
  for (const entry of rootValues) {
    const known = bestByHero.get(entry.heroId);
    if (!known || (known.tier === 'tail' && entry.tier === 'head')) {
      bestByHero.set(entry.heroId, entry);
    }
  }

  const scored: Array<{ rec: TournamentRecommendation; index: number; entry: RootCandidateValue }> = [];
  const unscored: TournamentRecommendation[] = [];
  recommendations.forEach((rec, index) => {
    const entry = bestByHero.get(rec.hero.hero_id);
    if (entry) scored.push({ rec, index, entry });
    else unscored.push(rec);
  });

  scored.sort(
    (a, b) =>
      (a.entry.tier === b.entry.tier ? 0 : a.entry.tier === 'head' ? -1 : 1) ||
      (b.entry.value - a.entry.value) ||
      (a.index - b.index),
  );

  const ordered = [...scored.map((entry) => entry.rec), ...unscored];
  const locked = options.lockedPlanHeroId ?? null;
  if (locked !== null) {
    const index = ordered.findIndex((rec) => rec.hero.hero_id === locked);
    if (index > 0) {
      return [ordered[index], ...ordered.slice(0, index), ...ordered.slice(index + 1)];
    }
  }
  return ordered;
}

export interface AdvisorRankingOptions {
  /** Lebar kandidat yang dievaluasi ulang (default sama dengan lebar solver). */
  width?: number;
  /** Plan yang dikunci pengguna; kandidat ini didahulukan apa adanya. */
  lockedPlanHeroId?: number | null;
}

/**
 * Mengurutkan ulang rekomendasi dengan evaluasi posisi 1-ply.
 *
 * Kandidat di luar lebar atas tetap mengikuti urutan sheet (mereka tidak layak
 * dipertarungkan dengan kandidat teratas). Kandidat yang dikunci pengguna selalu
 * di posisi pertama.
 */
export function rankRecommendationsByPosition(
  recommendations: TournamentRecommendation[],
  position: DraftPosition,
  context: SearchContext,
  options: AdvisorRankingOptions = {}
): TournamentRecommendation[] {
  if (recommendations.length <= 1) return recommendations;
  const width = Math.max(2, options.width ?? ADVISOR_RERANK_WIDTH);
  const head = recommendations.slice(0, width);
  const tail = recommendations.slice(width);
  const turn = getDraftTurn(position.step, context.format ?? 'tournament');
  if (!turn || turn.isComplete) return recommendations;

  const scored: Array<{ rec: TournamentRecommendation; eval: number; index: number }> = [];
  head.forEach((rec, index) => {
    const next = applyDraftAction(position, { ...turn, heroId: rec.hero.hero_id }, context);
    if (next === position) return;
    scored.push({ rec, eval: evaluatePosition(next, context, turn.side), index });
  });
  if (scored.length === 0) return recommendations;

  scored.sort((a, b) => (b.eval - a.eval) || (a.index - b.index));

  const locked = options.lockedPlanHeroId ?? null;
  const lockedEntry = locked != null ? scored.find((s) => s.rec.hero.hero_id === locked) : undefined;
  const rest = lockedEntry ? scored.filter((s) => s !== lockedEntry) : scored;
  const ordered = lockedEntry ? [lockedEntry, ...rest] : rest;

  // Kandidat yang gagal dievaluasi (aksi ilegal) tetap tampil, tapi di paling akhir.
  const rankedHead = ordered.map((s) => s.rec);
  const keptIds = new Set(rankedHead.map((rec) => rec.hero.hero_id));
  return [...rankedHead, ...tail, ...head.filter((rec) => !keptIds.has(rec.hero.hero_id))];
}

/**
 * Memperkaya dan mengurutkan paket duet menggunakan hasil pencarian Minimax (Game Theory)
 * ketika tim berada di langkah pertama jendela giliran ganda (R1+R2, B2+B3, B4+B5).
 *
 * 1. Jika Minimax memiliki Principal Variation dengan 2 aksi berurutan untuk sisi yang sama (PV[0] + PV[1]),
 *    pasangan tersebut diangkat sebagai "Paket Duet Utama Minimax" lengkap dengan prediksi respon musuh (PV[2]+PV[3]).
 * 2. Seluruh paket duet KPL lainnya dievaluasi nilai posisinya dengan `evaluatePosition` 2-ply.
 * 3. Paket diurutkan: Paket Minimax di urutan #1, diikuti paket berskor posisi tertinggi.
 */
export function enrichDuetPackagesWithMinimax(
  heuristicPackages: DuetPackageOption[],
  decision: AdvisorDecision | null | undefined,
  position: DraftPosition,
  context: SearchContext,
  heroesById: Map<number, Hero>,
  synergyDb?: Record<string, any>,
  format: DraftFormat = 'tournament',
  isUltimateBattle: boolean = false,
  rankedBanCount: 3 | 4 | 5 = 3
): DuetPackageOption[] {
  const window = getDoublePickWindow(position.step, format, isUltimateBattle, rankedBanCount);
  if (!window.isDoublePickFirst) return heuristicPackages;

  const turn = getDraftTurn(position.step, format, isUltimateBattle, rankedBanCount);
  if (!turn || turn.action !== 'pick') return heuristicPackages;

  const proPairs = synergyDb?.pairs || {};
  const kplLaneRates = synergyDb?.hero_lane_rates || {};
  const ourHeroes = position.picks[turn.side].map((id) => heroesById.get(id)!).filter(Boolean);
  const enemySide = oppositeSide(turn.side);

  const enriched: DuetPackageOption[] = [];
  const processedPairKeys = new Set<string>();

  // 1. Ekstrak Principal Variation Minimax (PV[0] + PV[1]) jika tersedia
  const pv = decision?.principalVariation;
  if (pv && pv.length >= 2 && pv[0].side === turn.side && pv[1].side === turn.side && pv[0].heroId !== pv[1].heroId) {
    const heroA = heroesById.get(pv[0].heroId);
    const heroB = heroesById.get(pv[1].heroId);

    if (heroA && heroB && !ourHeroes.some((h) => h.hero_id === heroA.hero_id || h.hero_id === heroB.hero_id)) {
      const integrity = evaluateTeamCompositionIntegrity([...ourHeroes, heroA, heroB], kplLaneRates);
      const laneA = integrity.laneState.assignments.get(heroA.hero_id);
      const laneB = integrity.laneState.assignments.get(heroB.hero_id);

      if (laneA && laneB && laneA !== laneB) {
        // Balasan musuh yang diprediksi Minimax (aksi lawan setelah pick ganda kita)
        const enemyActions = pv.slice(2).filter((a) => a.side === enemySide);
        const predictedResponses = enemyActions
          .map((a) => heroesById.get(a.heroId)!)
          .filter(Boolean);

        // Evaluasi skor posisi setelah kedua pick Minimax
        const nextPos1 = applyDraftAction(position, pv[0], context, format, isUltimateBattle, rankedBanCount);
        const nextPos2 = applyDraftAction(nextPos1, pv[1], context, format, isUltimateBattle, rankedBanCount);
        const minimaxEval = evaluatePosition(nextPos2, context, turn.side);

        // Cek data sinergi KPL untuk pasangan ini
        const p1 = Math.min(heroA.hero_id, heroB.hero_id);
        const p2 = Math.max(heroA.hero_id, heroB.hero_id);
        const pairKey = `${p1}_${p2}`;
        processedPairKeys.add(pairKey);
        const pairData = proPairs[pairKey] || proPairs[`${p1}:${p2}`];

        let kplLabel: string | undefined;
        if (pairData && (pairData.matches ?? 0) >= 15) {
          kplLabel = `Sinergi KPL: ${((pairData.win_rate ?? 0.5) * 100).toFixed(0)}% WR (${pairData.matches} match)`;
        }

        // Tentukan arketipe pasangan
        const aIsFrontline = heroA.primary_role === 'Tank' || (heroA.primary_role === 'Fighter' && heroA.tactical_profile?.tags.frontline);
        const bIsFrontline = heroB.primary_role === 'Tank' || (heroB.primary_role === 'Fighter' && heroB.tactical_profile?.tags.frontline);
        let archetype = 'Pilihan Utama Minimax';
        if ((aIsFrontline && !bIsFrontline) || (bIsFrontline && !aIsFrontline)) {
          archetype = 'Frontline Anchor + Core Carry (Minimax)';
        } else if (heroA.primary_role === 'Support' || heroB.primary_role === 'Support') {
          archetype = 'Peel & Protection Duo (Minimax)';
        }

        enriched.push({
          primaryHero: heroA,
          secondaryHero: heroB,
          combinedScore: 99.0, // Prioritas puncak
          duetWinRate: pairData?.win_rate,
          kplMatches: pairData?.matches,
          archetypeBadge: archetype,
          kplSynergyLabel: kplLabel,
          primaryLane: laneA,
          secondaryLane: laneB,
          windowLabel: heuristicPackages[0]?.windowLabel,
          isSolverDuet: true,
          solverScore: minimaxEval,
          predictedResponses,
        });
      }
    }
  }

  // 2. Evaluasi seluruh paket duet heuristik yang ada dengan evaluator posisi Minimax
  for (const pkg of heuristicPackages) {
    const p1 = Math.min(pkg.primaryHero.hero_id, pkg.secondaryHero.hero_id);
    const p2 = Math.max(pkg.primaryHero.hero_id, pkg.secondaryHero.hero_id);
    const pairKey = `${p1}_${p2}`;

    if (processedPairKeys.has(pairKey)) {
      continue; // Sudah masuk sebagai PV Minimax utama
    }
    processedPairKeys.add(pairKey);

    // Hitung posisi papan setelah mengunci kedua hero paket ini
    const actA: DraftAction = { side: turn.side, action: 'pick', heroId: pkg.primaryHero.hero_id };
    const actB: DraftAction = { side: turn.side, action: 'pick', heroId: pkg.secondaryHero.hero_id };
    const posA = applyDraftAction(position, actA, context, format, isUltimateBattle, rankedBanCount);
    const posB = applyDraftAction(posA, actB, context, format, isUltimateBattle, rankedBanCount);
    const evalScore = evaluatePosition(posB, context, turn.side);

    enriched.push({
      ...pkg,
      solverScore: evalScore,
    });
  }

  // 3. Urutkan: Paket Minimax (isSolverDuet) di posisi #1, diikuti solverScore descending
  enriched.sort((a, b) => {
    if (a.isSolverDuet && !b.isSolverDuet) return -1;
    if (!a.isSolverDuet && b.isSolverDuet) return 1;
    const scoreA = a.solverScore ?? a.combinedScore;
    const scoreB = b.solverScore ?? b.combinedScore;
    return scoreB - scoreA;
  });

  return enriched.slice(0, 3);
}
