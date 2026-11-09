import type { TournamentDataset } from '../types';
import type { DraftPosition, Side } from './draftRules';
import type { SearchContext } from './draftSearch';
import { searchDraft } from './draftSearch';

let dataset: TournamentDataset | null = null;
let aiSide: Side = 'red';
self.onmessage = (event: MessageEvent) => {
  const request = event.data;
  if (request.type === 'init') { dataset = request.dataset; aiSide = request.aiSide; return; }
  if (request.type !== 'decide' || !dataset) return;
  const { sessionId, revision, position, fearless, aiPlan } = request as {
    sessionId: string; revision: number; position: DraftPosition;
    fearless: SearchContext['fearless']; aiPlan: SearchContext['aiPlan'];
  };
  try {
    const decision = searchDraft(position, { heroes: dataset.heroes, synergy: dataset.synergy, onlyGlobal: true, fearless, aiSide, aiPlan });
    self.postMessage({ sessionId, revision, decision });
  } catch { self.postMessage({ sessionId, revision, error: 'Keputusan AI belum tersedia.' }); }
};
