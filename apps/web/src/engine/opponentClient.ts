import type { TournamentDataset } from '../types';
import type { DraftPosition, Side } from './draftRules';
import { rankedCandidates } from './draftSearch';
import type { SearchContext, SearchDecision } from './draftSearch';

export interface DecisionTag { sessionId: string; revision: number }
export function matchesDecisionTag(a: DecisionTag, b: DecisionTag) { return a.sessionId === b.sessionId && a.revision === b.revision; }

/** One worker per active session; cancel terminates computation, not just its callback. */
export class OpponentClient {
  private worker: Worker | null = null;
  private abortPending: (() => void) | null = null;
  constructor(private dataset: TournamentDataset, private aiSide: Side) {}

  cancel() {
    this.abortPending?.(); this.abortPending = null;
    this.worker?.terminate(); this.worker = null;
  }
  decide(position: DraftPosition, settings: Pick<SearchContext, 'fearless' | 'aiPlan'>, tag: DecisionTag, signal: AbortSignal): Promise<SearchDecision> {
    if (signal.aborted) return Promise.reject(new DOMException('Dibatalkan', 'AbortError'));
    const context: SearchContext = { heroes: this.dataset.heroes, synergy: this.dataset.synergy, aiSide: this.aiSide, onlyGlobal: true, ...settings };
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
      timer = setTimeout(fallback, 2000);
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
        this.worker.postMessage({ type: 'decide', ...tag, position, fearless: settings.fearless, aiPlan: settings.aiPlan });
      } catch { fallback(); }
    });
  }
}
