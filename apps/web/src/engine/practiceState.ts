import type { DraftFormat, TournamentDataset } from '../types';
import { applyDraftAction, emptyPosition, getDraftTurn, oppositeSide } from './draftRules';
import type { DraftAction, DraftContext, DraftPosition, Side } from './draftRules';
import { matchesDecisionTag } from './opponentClient';
import type { DecisionTag } from './opponentClient';
import { rankedCandidates } from './draftSearch';
import { runTournamentInference } from './tournamentInference';

export interface PracticeConfig { playerSide: Side; fearless: boolean; format?: DraftFormat; onlyGlobal?: boolean; rankedBanCount?: 3 | 4 | 5 }
export interface DecisionTrace {
  actionIndex: number;
  heroId: number;
  partnerHeroId?: number;
  alternatives: Array<{ heroId: number; reason: string }>;
}
export interface PracticeGame {
  position: DraftPosition;
  actions: DraftAction[];
  traces: DecisionTrace[];
  playerPlan: { a: number | null; b: number | null };
  aiPlan: { a: number | null; b: number | null };
}
export interface PracticeSession extends DecisionTag {
  config: PracticeConfig;
  gameIndex: number;
  games: PracticeGame[];
}
export function practiceContext(session: PracticeSession, dataset: TournamentDataset): DraftContext {
  const fearless: Record<Side, number[]> = { blue: [], red: [] };
  if (session.config.fearless) for (const game of session.games.slice(0, session.gameIndex)) {
    fearless.blue.push(...game.position.picks.blue); fearless.red.push(...game.position.picks.red);
  }
  return { heroes: dataset.heroes, onlyGlobal: session.config.onlyGlobal ?? true, fearless, format: session.config.format, rankedBanCount: session.config.rankedBanCount ?? 3 };
}
function createGame(dataset: TournamentDataset, config: PracticeConfig, context: DraftContext): PracticeGame {
  const aiSide = oppositeSide(config.playerSide);
  const result = runTournamentInference([], [], [], context.fearless[aiSide], false, aiSide === 'blue', dataset.heroes, 0, null, null, context.onlyGlobal, dataset.synergy, context.fearless[config.playerSide], config.format);
  const candidates = result.phaseStrategy.candidateOpeners.filter(h => !context.fearless[aiSide].includes(h.hero_id));
  return { position: emptyPosition(), actions: [], traces: [], playerPlan: { a: null, b: null }, aiPlan: { a: candidates[0]?.hero_id ?? null, b: candidates.find(h => h.primary_lane !== candidates[0]?.primary_lane)?.hero_id ?? candidates[1]?.hero_id ?? null } };
}
export function createPracticeSession(sessionId: string, config: PracticeConfig, dataset: TournamentDataset): PracticeSession {
  const context: DraftContext = { heroes: dataset.heroes, onlyGlobal: config.onlyGlobal ?? true, fearless: { blue: [], red: [] }, format: config.format, rankedBanCount: config.rankedBanCount ?? 3 };
  return { sessionId, revision: 0, config, gameIndex: 0, games: [createGame(dataset, config, context)] };
}
export type PracticeEvent =
  | { type: 'commit'; tag: DecisionTag; actor: 'human' | 'ai'; heroId: number }
  | { type: 'commit-duet'; tag: DecisionTag; actor: 'human'; heroIds: [number, number] }
  | { type: 'undo' | 'reset' | 'next' | 'retry' }
  | { type: 'view'; index: number }
  | { type: 'plan'; plan: 'a' | 'b'; heroId: number | null };

function applyPracticeAction(position: DraftPosition, action: DraftAction, context: DraftContext, format: DraftFormat = context.format ?? 'tournament'): DraftPosition {
  const next = applyDraftAction(position, { side: action.side, action: action.action, heroId: action.heroId }, context, format);
  if (next === position) return position;
  if (action.secondHeroId === undefined) return next;
  const turn = getDraftTurn(next.step, format);
  if (turn.action !== 'pick' || turn.side !== action.side) return next;
  const after = applyDraftAction(next, { side: turn.side, action: turn.action, heroId: action.secondHeroId }, context, format);
  return after === next ? next : after;
}

export function reducePractice(session: PracticeSession, event: PracticeEvent, dataset: TournamentDataset): PracticeSession {
  const current = session.games[session.gameIndex];
  const latest = session.gameIndex === session.games.length - 1;
  const context = practiceContext(session, dataset);
  const replace = (game: PracticeGame) => ({ ...session, revision: session.revision + 1, games: session.games.map((value, index) => index === session.gameIndex ? game : value) });
  if (event.type === 'view') {
    if (!Number.isInteger(event.index) || event.index < 0 || event.index >= session.games.length || event.index === session.gameIndex) return session;
    return { ...session, gameIndex: event.index, revision: session.revision + 1 };
  }
  if (!latest) return session;
  if (event.type === 'commit') {
    if (!matchesDecisionTag(session, event.tag)) return session;
    const turn = getDraftTurn(current.position.step, session.config.format, false, session.config.rankedBanCount ?? 3);
    if ((turn.side === session.config.playerSide) !== (event.actor === 'human')) return session;
    const action = { side: turn.side, action: turn.action, heroId: event.heroId };
    const position = applyDraftAction(current.position, action, context, session.config.format);
    if (position === current.position) return session;
    const traces = [...current.traces];
    if (event.actor === 'human') {
      const suggestions = rankedCandidates(current.position, { ...context, synergy: dataset.synergy, aiSide: session.config.playerSide, aiPlan: current.playerPlan, format: session.config.format });
      traces.push({ actionIndex: current.actions.length, heroId: event.heroId, alternatives: suggestions.filter(r => r.hero.hero_id !== event.heroId).slice(0, 3).map(r => ({ heroId: r.hero.hero_id, reason: r.proComboTag || r.laneTag || 'Prioritas komposisi dan meta' })) });
    }
    return replace({ ...current, position, actions: [...current.actions, action], traces });
  }
  if (event.type === 'commit-duet') {
    if (!matchesDecisionTag(session, event.tag)) return session;
    if (event.heroIds.length !== 2) return session;
    const turn = getDraftTurn(current.position.step, session.config.format, false, session.config.rankedBanCount ?? 3);
    if (turn.action !== 'pick' || turn.side !== session.config.playerSide) return session;
    const [primaryId, secondaryId] = event.heroIds;
    // Atomic: both picks must be legal before anything is applied.
    const probe = applyDraftAction(current.position, { side: turn.side, action: 'pick', heroId: primaryId }, context, session.config.format);
    if (probe === current.position) return session;
    const partnerTurn = getDraftTurn(probe.step, session.config.format, false, session.config.rankedBanCount ?? 3);
    if (partnerTurn.action !== 'pick' || partnerTurn.side !== turn.side) return session;
    const position = applyDraftAction(probe, { side: partnerTurn.side, action: partnerTurn.action, heroId: secondaryId }, context, session.config.format);
    if (position === probe) return session;
    const options = rankedCandidates(current.position, { ...context, synergy: dataset.synergy, aiSide: session.config.playerSide, aiPlan: current.playerPlan, format: session.config.format });
    const alternatives = options.filter(r => r.hero.hero_id !== primaryId && r.hero.hero_id !== secondaryId).slice(0, 3).map(r => ({ heroId: r.hero.hero_id, reason: r.proComboTag || r.laneTag || 'Prioritas komposisi dan meta' }));
    const action: DraftAction = { side: turn.side, action: 'pick', heroId: primaryId, secondHeroId: secondaryId };
    return replace({ ...current, position, actions: [...current.actions, action], traces: [...current.traces, { actionIndex: current.actions.length, heroId: primaryId, partnerHeroId: secondaryId, alternatives }] });
  }
  if (event.type === 'plan') {
    if (event.heroId !== null && !dataset.heroes.some(h => h.hero_id === event.heroId && h.is_global_released === true)) return session;
    return replace({ ...current, playerPlan: { ...current.playerPlan, [event.plan]: event.heroId } });
  }
  if (event.type === 'retry') return { ...session, revision: session.revision + 1 };
  if (event.type === 'reset') return replace(createGame(dataset, session.config, context));
  if (event.type === 'undo') {
    let index = current.actions.length - 1;
    while (index >= 0 && current.actions[index].side !== session.config.playerSide) index--;
    if (index < 0) return session;
    const actions = current.actions.slice(0, index);
    const position = actions.reduce((state, action) => applyPracticeAction(state, action, context, session.config.format), emptyPosition());
    return replace({ ...current, position, actions, traces: current.traces.filter(trace => trace.actionIndex < index) });
  }
  const maxSteps = session.config.format === 'ranked' ? 2 * (session.config.rankedBanCount ?? 3) + 10 : 18;
  if (event.type === 'next' && current.position.step === maxSteps && session.games.length < 5) {
    const next = { ...session, gameIndex: session.games.length, revision: session.revision + 1 };
    return { ...next, games: [...session.games, createGame(dataset, session.config, practiceContext(next, dataset))] };
  }
  return session;
}
