import type { Hero, TournamentDataset } from '../types';
import { analyzeLaneOccupancy, applyDraftAction, DRAFT_SEQUENCE, getDraftTurn, isLegalHero, isRiskyOpener, oppositeSide } from './draftRules';
import type { DraftContext, DraftPosition, DraftAction, Side } from './draftRules';
import { evaluateTacticalScores, runTournamentInference } from './tournamentInference';

export interface SearchContext extends DraftContext {
  synergy: TournamentDataset['synergy'];
  aiSide: Side;
  aiPlan: { a: number | null; b: number | null };
}
export interface SearchDecision {
  heroId: number | null;
  engineKind: 'deterministic' | 'search';
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  principalVariation: DraftAction[];
  fallbackReason?: string;
}
export interface SearchOptions { maxDepth?: number; width?: number; budgetMs?: number; now?: () => number }

export function rankedCandidates(position: DraftPosition, context: SearchContext) {
  const turn = getDraftTurn(position.step);
  if (turn.isComplete) return [];
  const result = runTournamentInference(position.picks[turn.side], position.picks[oppositeSide(turn.side)],
    [...position.bans.blue, ...position.bans.red], context.fearless[turn.side], turn.action === 'pick', turn.side === 'blue',
    context.heroes, position.step, turn.side === context.aiSide ? context.aiPlan.a : null,
    turn.side === context.aiSide ? context.aiPlan.b : null, context.onlyGlobal, context.synergy, context.fearless[oppositeSide(turn.side)]);
  const legal = result.recommendations.filter(r => isLegalHero(position, r.hero.hero_id, context));
  if (turn.action === 'ban') return legal;
  const our = context.heroes.filter(h => position.picks[turn.side].includes(h.hero_id));
  const fits = legal.filter(r => analyzeLaneOccupancy([...our, r.hero]).occupiedLanes.size === our.length + 1);
  return fits.length ? fits : legal;
}

const tierWeight = (h: Hero) => ({ S: 0.35, A: 0.20, B: 0.05, C: -0.10, D: -0.25 }[h.tier] ?? 0);
function pairBonus(a: Hero, b: Hero, context: SearchContext) {
  const pair = context.synergy.pairs?.[`${Math.min(a.hero_id, b.hero_id)}_${Math.max(a.hero_id, b.hero_id)}`];
  return pair?.matches >= 20 && pair.win_rate >= 0.5 ? (pair.synergy_lift || 0) * 2.2 + 0.35 : 0;
}
function counterBonus(our: Hero[], enemy: Hero[]) {
  return our.reduce((sum, h) => sum + enemy.filter(e => h.counters.some(c => c.target_id === e.hero_id) || e.countered_by.some(c => c.counter_id === h.hero_id)).length * 0.5, 0);
}

/** Antisymmetric positional value; these numbers are not match win probabilities. */
export function evaluatePosition(position: DraftPosition, context: SearchContext, perspective: Side): number {
  const byId = new Map(context.heroes.map(h => [h.hero_id, h]));
  const team = (side: Side) => position.picks[side].map(id => byId.get(id)!).filter(Boolean);
  const strength = (side: Side) => {
    const ours = team(side), enemy = team(oppositeSide(side));
    const radar = evaluateTacticalScores(ours, enemy);
    const coverage = analyzeLaneOccupancy(ours).occupiedLanes.size;
    let score = ours.reduce((sum, h) => sum + (h.win_rate - 0.48) * 4 + tierWeight(h) + h.pick_rate * 2.8, 0);
    score += radar.early_game_pressure + radar.cc_chain_lockdown + radar.frontline_durability + radar.enemy_carry_shutdown + radar.draft_flexibility + radar.team_utility;
    score += counterBonus(ours, enemy) - (ours.length - coverage) * 2.5;
    for (let i = 0; i < ours.length; i++) for (let j = i + 1; j < ours.length; j++) score += pairBonus(ours[i], ours[j], context);
    if (ours.length === 5) return score;
    // Available follow-ups keep ban positions meaningful before the first pick.
    const projected = { ...position, step: side === 'blue' ? 4 : 5 };
    let potential = -2.5;
    for (const h of context.heroes) {
      if (!isLegalHero(projected, h.hero_id, context)) continue;
      if (position.step <= 4 && isRiskyOpener(h)) continue;
      if (analyzeLaneOccupancy([...ours, h]).occupiedLanes.size !== ours.length + 1) continue;
      const value = (h.win_rate - 0.48) * 4 + tierWeight(h) + h.pick_rate * 2.8 + counterBonus([h], enemy)
        + ours.reduce((sum, teammate) => sum + pairBonus(h, teammate, context), 0);
      potential = Math.max(potential, value);
    }
    return score + potential * 0.25;
  };
  return strength(perspective) - strength(oppositeSide(perspective));
}

export function searchDraft(position: DraftPosition, context: SearchContext, options: SearchOptions = {}): SearchDecision {
  const now = options.now ?? (() => performance.now());
  const start = now();
  const deadline = start + Math.min(1500, Math.max(0, options.budgetMs ?? 1500));
  const maxDepth = Math.min(4, DRAFT_SEQUENCE.length - position.step, Math.max(1, options.maxDepth ?? 4));
  const width = Math.min(8, Math.max(1, options.width ?? 8));
  const rootSide = getDraftTurn(position.step).side;
  const root = rankedCandidates(position, context).slice(0, width);
  const first = root[0];
  const decision: SearchDecision = { heroId: first?.hero.hero_id ?? null, engineKind: 'deterministic', completedDepth: 0, nodes: 0, elapsedMs: 0, principalVariation: [] };
  if (!first) return decision;
  const timeout = Symbol('timeout');
  const check = () => { if (now() >= deadline) throw timeout; };
  const candidateCache = new Map<string, ReturnType<typeof rankedCandidates>>();
  const valueCache = new Map<string, number>();
  const key = (p: DraftPosition) => `${p.step}:${p.picks.blue}:${p.picks.red}:${p.bans.blue}:${p.bans.red}`;
  const visit = (p: DraftPosition, depth: number, alpha: number, beta: number): { value: number; line: DraftAction[] } => {
    check(); decision.nodes++;
    const k = key(p), turn = getDraftTurn(p.step);
    if (!depth || turn.isComplete) {
      if (!valueCache.has(k)) valueCache.set(k, evaluatePosition(p, context, rootSide));
      check();
      return { value: valueCache.get(k)!, line: [] };
    }
    if (!candidateCache.has(k)) candidateCache.set(k, rankedCandidates(p, context).slice(0, width));
    check();
    const candidates = candidateCache.get(k)!;
    if (!candidates.length) return { value: evaluatePosition(p, context, rootSide), line: [] };
    const maximizing = turn.side === rootSide;
    let best = { value: maximizing ? -Infinity : Infinity, line: [] as DraftAction[] };
    for (const candidate of candidates) {
      check();
      const action = { side: turn.side, action: turn.action, heroId: candidate.hero.hero_id };
      const result = visit(applyDraftAction(p, action, context), depth - 1, alpha, beta);
      if (maximizing ? result.value > best.value : result.value < best.value) best = { value: result.value, line: [action, ...result.line] };
      if (maximizing) alpha = Math.max(alpha, best.value); else beta = Math.min(beta, best.value);
      if (beta <= alpha) break;
    }
    return best;
  };
  candidateCache.set(key(position), root);
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const result = visit(position, depth, -Infinity, Infinity);
      decision.heroId = result.line[0]?.heroId ?? decision.heroId;
      decision.principalVariation = result.line;
      decision.completedDepth = depth;
      decision.engineKind = 'search';
    } catch (error) { if (error === timeout) break; throw error; }
  }
  decision.elapsedMs = Math.round(now() - start);
  return decision;
}
