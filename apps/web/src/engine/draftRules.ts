import type { GameDraftData, Hero, Lane } from '../types';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';

export type Side = 'blue' | 'red';
export type ActionKind = 'ban' | 'pick';
export type TournamentPhaseId = 'BAN_PHASE_1' | 'PICK_PHASE_1' | 'BAN_PHASE_2' | 'PICK_PHASE_2' | 'DRAFT_COMPLETE';
export const IMMOBILE_OPENERS = new Set([112, 169, 142, 109, 504]);
export const ALL_LANES: Lane[] = ['Clash', 'Jungle', 'Mid', 'Farm', 'Roam'];
export const DRAFT_SEQUENCE: ReadonlyArray<{ side: Side; action: ActionKind }> = [
  { side: 'blue', action: 'ban' }, { side: 'red', action: 'ban' },
  { side: 'blue', action: 'ban' }, { side: 'red', action: 'ban' },
  { side: 'blue', action: 'pick' }, { side: 'red', action: 'pick' },
  { side: 'red', action: 'pick' }, { side: 'blue', action: 'pick' },
  { side: 'blue', action: 'pick' }, { side: 'red', action: 'pick' },
  { side: 'red', action: 'ban' }, { side: 'blue', action: 'ban' },
  { side: 'red', action: 'ban' }, { side: 'blue', action: 'ban' },
  { side: 'red', action: 'pick' }, { side: 'blue', action: 'pick' },
  { side: 'blue', action: 'pick' }, { side: 'red', action: 'pick' },
];
export const TOURNAMENT_PHASES = [
  { id: 'BAN_PHASE_1', label: '1. Ban fase 1', sub: 'Lindungi opener', start: 0, end: 3, isBan: true },
  { id: 'PICK_PHASE_1', label: '2. Pick fase 1', sub: 'Bentuk core tim', start: 4, end: 9, isBan: false },
  { id: 'BAN_PHASE_2', label: '3. Ban fase 2', sub: 'Putus kombo lawan', start: 10, end: 13, isBan: true },
  { id: 'PICK_PHASE_2', label: '4. Pick fase 2', sub: 'Lengkapi komposisi', start: 14, end: 17, isBan: false },
] as const;
export const oppositeSide = (side: Side): Side => side === 'blue' ? 'red' : 'blue';
export const getTournamentPhase = (step: number): TournamentPhaseId =>
  TOURNAMENT_PHASES.find(p => step >= p.start && step <= p.end)?.id ?? 'DRAFT_COMPLETE';
export function getDraftTurn(step: number) {
  const turn = DRAFT_SEQUENCE[step];
  return { ...(turn ?? { side: 'blue' as const, action: 'pick' as const }), stepIndex: step, isComplete: !turn };
}

export interface DraftPosition {
  step: number;
  picks: Record<Side, number[]>;
  bans: Record<Side, number[]>;
}
export interface DraftContext {
  heroes: Hero[];
  onlyGlobal: boolean;
  fearless: Record<Side, number[]>;
}
export interface DraftAction { heroId: number; side: Side; action: ActionKind }
export const emptyPosition = (): DraftPosition => ({ step: 0, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } });
export function isLegalHero(position: DraftPosition, heroId: number, context: DraftContext): boolean {
  const turn = getDraftTurn(position.step);
  const hero = context.heroes.find(h => h.hero_id === heroId);
  if (turn.isComplete || !hero || heroId === 511 || (context.onlyGlobal && !isHeroGlobalReleased(hero))) return false;
  if ([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red].includes(heroId)) return false;
  return turn.action !== 'pick' || !context.fearless[turn.side].includes(heroId);
}
export function applyDraftAction(position: DraftPosition, action: DraftAction, context: DraftContext): DraftPosition {
  const turn = getDraftTurn(position.step);
  if (turn.side !== action.side || turn.action !== action.action || !isLegalHero(position, action.heroId, context)) return position;
  const field = turn.action === 'pick' ? 'picks' : 'bans';
  return { ...position, step: position.step + 1, [field]: { ...position[field], [turn.side]: [...position[field][turn.side], action.heroId] } };
}
export const createInitialGameDraft = (): GameDraftData => ({
  bluePicks: Array(5).fill(null), redPicks: Array(5).fill(null), blueBans: Array(4).fill(null), redBans: Array(4).fill(null),
  draftStep: 0, bluePlanAId: null, bluePlanBId: null, redPlanAId: null, redPlanBId: null,
});
export function toPosition(game: GameDraftData): DraftPosition {
  const ids = (xs: Array<Hero | null>) => xs.filter((h): h is Hero => h !== null).map(h => h.hero_id);
  return { step: game.draftStep, picks: { blue: ids(game.bluePicks), red: ids(game.redPicks) }, bans: { blue: ids(game.blueBans), red: ids(game.redBans) } };
}
export function applyGameHero(game: GameDraftData, hero: Hero, context: DraftContext): GameDraftData {
  const position = toPosition(game);
  const turn = getDraftTurn(position.step);
  const next = applyDraftAction(position, { ...turn, heroId: hero.hero_id }, context);
  if (next === position) return game;
  const key = `${turn.side}${turn.action === 'pick' ? 'Picks' : 'Bans'}` as 'bluePicks' | 'redPicks' | 'blueBans' | 'redBans';
  const slots = [...game[key]];
  const index = slots.findIndex(h => h === null);
  if (index < 0) return game;
  slots[index] = hero;
  return { ...game, [key]: slots, draftStep: next.step };
}

/** Maximum matching, so a flex hero never steals the sole lane of another hero. */
export function analyzeLaneOccupancy(heroes: Hero[]): { occupiedLanes: Set<Lane>; vacantLanes: Set<Lane> } {
  let best = new Set<Lane>();
  const walk = (index: number, used: Set<Lane>) => {
    if (used.size > best.size) best = new Set(used);
    if (index === heroes.length || best.size === Math.min(5, heroes.length)) return;
    const lanes = new Set([heroes[index].primary_lane, ...heroes[index].lanes]);
    for (const lane of lanes) if (ALL_LANES.includes(lane) && !used.has(lane)) {
      used.add(lane); walk(index + 1, used); used.delete(lane);
    }
    walk(index + 1, used);
  };
  walk(0, new Set());
  return { occupiedLanes: best, vacantLanes: new Set(ALL_LANES.filter(l => !best.has(l))) };
}
