import type { TournamentDataset } from '../types';
import type { DraftPosition, Side } from './draftRules';
import type { SearchContext, SearchOptions } from './draftSearch';
import { searchDraft } from './draftSearch';

/**
 * Opsi pencarian yang boleh dikirim lewat protokol worker.
 * `now` sengaja tidak diekspos: jam harus tetap milik worker.
 *
 * `orderCandidates` hanya dipakai jalur advisor (nilai per kandidat → urutan
 * penuh daftar). Jalur lawan AI tidak pernah menyalakannya.
 */
export type WorkerSearchOptions = Pick<
  SearchOptions,
  'maxDepth' | 'width' | 'budgetMs' | 'allowExtendedBudget' | 'orderCandidates' | 'orderTailDepth' | 'orderTailLimit'
>;

let dataset: TournamentDataset | null = null;
let aiSide: Side = 'red';
self.onmessage = (event: MessageEvent) => {
  const request = event.data;
  if (request.type === 'init') { dataset = request.dataset; aiSide = request.aiSide; return; }
  if (request.type !== 'decide' || !dataset) return;
  const { sessionId, revision, position, fearless, aiPlan, format, side, options, isUltimateBattle, rankedBanCount } = request as {
    sessionId: string; revision: number; position: DraftPosition;
    fearless: SearchContext['fearless']; aiPlan: SearchContext['aiPlan'];
    format?: SearchContext['format'];
    /**
     * Sisi yang sedang bergiliran. Bila ada (jalur advisor), konteks dibangun dengan
     * `aiSide: side` dan plan KOSONG: Plan A/B milik pemain tidak pernah boleh dikirim
     * ke pencari (AGENTS.md §4.F). Bila tidak ada, perilaku lawan AI lama dipertahankan
     * (`aiSide` dari `init` + `aiPlan` dari request).
     */
    side?: Side;
    /** Opsi pencarian (advisor memakai anggaran panjang lewat `allowExtendedBudget`). */
    options?: WorkerSearchOptions;
    /**
     * Mode Ultimate Battle (Game 7) punya urutan 10 langkah tanpa ban. Tanpa field ini
     * pencari akan membaca urutan turnamen 18 langkah dan bisa menilai sisi yang salah.
     */
    isUltimateBattle?: boolean;
    /**
     * Jumlah ban per sisi pada mode ranked (3/4/5). Tanpa ini urutan ranked 4/5 ban
     * akan dibaca sebagai urutan 3 ban — giliran yang salah dinilai.
     */
    rankedBanCount?: 3 | 4 | 5;
  };
  try {
    const context: SearchContext = {
      heroes: dataset.heroes,
      synergy: dataset.synergy,
      onlyGlobal: true,
      fearless,
      aiSide: side ?? aiSide,
      aiPlan: side ? { a: null, b: null } : aiPlan,
      format,
      isUltimateBattle,
      rankedBanCount,
    };
    const decision = searchDraft(position, context, options ?? {});
    self.postMessage({ sessionId, revision, decision });
  } catch { self.postMessage({ sessionId, revision, error: 'Keputusan AI belum tersedia.' }); }
};
