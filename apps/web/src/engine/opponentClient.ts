import type { TournamentDataset } from '../types';
import type { DraftPosition, Side } from './draftRules';
import { rankedCandidates } from './draftSearch';
import type { SearchContext, SearchDecision } from './draftSearch';
import { MAX_SEARCH_BUDGET_MS } from './draftSearch';
import type { WorkerSearchOptions } from './opponent.worker';

export interface DecisionTag { sessionId: string; revision: number }
export function matchesDecisionTag(a: DecisionTag, b: DecisionTag) { return a.sessionId === b.sessionId && a.revision === b.revision; }

/**
 * Watchdog jalur lawan AI: pencarian 1.500 ms selalu selesai jauh di bawah 2 s.
 * Permintaan advisor yang menyalakan `allowExtendedBudget` mendapat watchdog yang
 * menutupi anggarannya — kalau tidak, anggaran 8 s akan dipotong diam-diam di 2 s
 * dan janji "langkah terbaik, latensi tidak penting" tidak pernah tercapai.
 */
const OPPONENT_WATCHDOG_MS = 2000;

/** Setelan satu permintaan `decide`. Semua field opsional. */
export interface DecideSettings {
  fearless: SearchContext['fearless'];
  aiPlan: SearchContext['aiPlan'];
  format?: SearchContext['format'];
  /** Sisi yang bergiliran (jalur advisor). Bila ada, Plan A/B diabaikan. */
  side?: Side;
  /** Opsi pencarian yang diteruskan ke `searchDraft` di dalam worker. */
  options?: WorkerSearchOptions;
  /** Mode Ultimate Battle (Game 7): urutan 10 langkah tanpa ban. */
  isUltimateBattle?: boolean;
  /** Jumlah ban per sisi pada mode ranked (3/4/5) — harus sama dengan board. */
  rankedBanCount?: 3 | 4 | 5;
}

/** One worker at a time; cancel terminates computation, not just its callback. */
export class OpponentClient {
  private worker: Worker | null = null;
  private abortPending: (() => void) | null = null;
  constructor(private dataset: TournamentDataset, private aiSide: Side) {}

  cancel() {
    this.abortPending?.(); this.abortPending = null;
    this.worker?.terminate(); this.worker = null;
  }
  decide(position: DraftPosition, settings: DecideSettings, tag: DecisionTag, signal: AbortSignal): Promise<SearchDecision> {
    if (signal.aborted) return Promise.reject(new DOMException('Dibatalkan', 'AbortError'));
    // Konteks lokal hanya dipakai jalur fallback; sisi/plan mengikuti permintaan agar
    // fallback advisor tidak menilai posisi dari sisi yang salah.
    const context: SearchContext = {
      heroes: this.dataset.heroes,
      synergy: this.dataset.synergy,
      aiSide: settings.side ?? this.aiSide,
      onlyGlobal: true,
      fearless: settings.fearless,
      aiPlan: settings.side ? { a: null, b: null } : settings.aiPlan,
      format: settings.format,
      isUltimateBattle: settings.isUltimateBattle,
      rankedBanCount: settings.rankedBanCount,
    };
    const watchdogMs = settings.options?.allowExtendedBudget === true
      ? Math.max(OPPONENT_WATCHDOG_MS, (settings.options.budgetMs ?? MAX_SEARCH_BUDGET_MS) + 500)
      : OPPONENT_WATCHDOG_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.abortPending = null; };
      const finish = (result: SearchDecision) => { if (settled) return; settled = true; cleanup(); resolve(result); };
      const abort = () => { if (settled) return; settled = true; cleanup(); this.worker?.terminate(); this.worker = null; reject(new DOMException('Dibatalkan', 'AbortError')); };
      this.abortPending = abort;
      signal.addEventListener('abort', abort, { once: true });
      const fallback = () => {
        if (settled) return;
        this.worker?.terminate(); this.worker = null;
        const first = rankedCandidates(position, context)[0];
        finish({ heroId: first?.hero.hero_id ?? null, engineKind: 'deterministic', completedDepth: 0, nodes: 0, elapsedMs: 0, principalVariation: [], fallbackReason: 'Pencarian AI terhenti. Mesin taktis lokal mengambil alih.' });
      };
      timer = setTimeout(fallback, watchdogMs);
      try {
        if (!this.worker) {
          this.worker = new Worker(new URL('./opponent.worker.ts', import.meta.url), { type: 'module' });
          this.worker.postMessage({ type: 'init', dataset: this.dataset, aiSide: this.aiSide });
        }
        this.worker.onerror = fallback;
        this.worker.onmessage = ({ data }) => {
          if (!matchesDecisionTag(data, tag)) return;
          if (data.error) fallback(); else finish(data.decision);
        };
        this.worker.postMessage({
          type: 'decide', ...tag, position,
          fearless: settings.fearless, aiPlan: settings.aiPlan, format: settings.format,
          side: settings.side, options: settings.options, isUltimateBattle: settings.isUltimateBattle,
          rankedBanCount: settings.rankedBanCount,
        });
      } catch { fallback(); }
    });
  }
}
