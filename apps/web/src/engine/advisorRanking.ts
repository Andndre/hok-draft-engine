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
 * - Plan A/B yang dikunci pengguna tetap didahulukan: keputusan pengguna bukan
 *   tebakan mesin.
 * - `plannedOpener` hasil tebakan mesin TIDAK dipaksa jadi #1 — diukur, itu
 *   menurunkan kesesuaian dari 63,4% ke 4,9%.
 */
import type { Hero } from '../types';
import type { DraftPosition } from './draftRules';
import { applyDraftAction, getDraftTurn } from './draftRules';
import { evaluatePosition } from './draftSearch';
import type { SearchContext } from './draftSearch';
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
}

/**
 * Menaikkan pilihan solver ke posisi pertama daftar rekomendasi yang dilihat pengguna.
 *
 * Sisa daftar mempertahankan urutannya (urutan 1-ply yang cepat). Mengembalikan daftar
 * apa adanya bila id null/undefined, tidak ditemukan, atau sudah di posisi pertama —
 * sehingga pemanggil tidak perlu memeriksa kondisi itu sendiri.
 */
export function promoteAdvisorPick(
  recommendations: TournamentRecommendation[],
  heroId: number | null | undefined
): TournamentRecommendation[] {
  if (heroId === null || heroId === undefined) return recommendations;
  const index = recommendations.findIndex((rec) => rec.hero.hero_id === heroId);
  if (index <= 0) return recommendations;
  return [recommendations[index], ...recommendations.slice(0, index), ...recommendations.slice(index + 1)];
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
