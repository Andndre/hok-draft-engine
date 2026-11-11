import type { GameDraftData, Hero, KplLaneRate, Lane, LaneAssignmentMap } from '../types';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';

export type Side = 'blue' | 'red';
export type ActionKind = 'ban' | 'pick';
export type TournamentPhaseId = 'BAN_PHASE_1' | 'PICK_PHASE_1' | 'BAN_PHASE_2' | 'PICK_PHASE_2' | 'DRAFT_COMPLETE';
export const IMMOBILE_OPENERS = new Set([112, 169, 142, 109, 504]);
export function isRiskyOpener(hero: Hero): boolean {
  const tags = hero.tactical_profile?.tags;
  return IMMOBILE_OPENERS.has(hero.hero_id) || (tags?.dive_vulnerable === true && tags.mobility === false && ['Mage', 'Marksman'].includes(hero.primary_role));
}
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

export type KplLaneRateMap = Record<string, Partial<Record<Lane, KplLaneRate>>>;

function getCandidateLanesWithWeights(
  hero: Hero,
  kplLaneRates?: KplLaneRateMap
): Array<{ lane: Lane; weight: number }> {
  const weights = new Map<Lane, number>();
  if (ALL_LANES.includes(hero.primary_lane)) {
    weights.set(hero.primary_lane, 100);
  }
  for (const lane of hero.lanes) {
    if (ALL_LANES.includes(lane) && !weights.has(lane)) {
      const kplStat = kplLaneRates?.[String(hero.hero_id)]?.[lane];
      weights.set(lane, 40 + (kplStat ? kplStat.share * 10 : 0));
    }
  }
  const proLanes = kplLaneRates?.[String(hero.hero_id)];
  if (proLanes) {
    for (const lane of ALL_LANES) {
      const stat = proLanes[lane];
      if (stat && stat.games >= 20 && stat.share >= 0.15 && !weights.has(lane)) {
        weights.set(lane, 20 + stat.share * 10);
      }
    }
  }
  return [...weights.entries()]
    .map(([lane, weight]) => ({ lane, weight }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Maximum weighted bipartite matching, so a flex hero (official or high-confidence KPL)
 * shifts cleanly without stealing another teammate's sole lane.
 */
export function assignHeroLanes(
  heroes: Hero[],
  kplLaneRates?: KplLaneRateMap
): {
  assignments: Map<number, Lane>;
  byLane: LaneAssignmentMap;
  occupiedLanes: Set<Lane>;
  vacantLanes: Set<Lane>;
} {
  const candidates = heroes.slice(0, 5).map(hero => ({
    hero,
    options: getCandidateLanesWithWeights(hero, kplLaneRates),
  }));
  let bestCount = -1;
  let bestScore = -1;
  let bestPairs: Array<[number, Lane]> = [];
  const used = new Set<Lane>();
  const current: Array<[number, Lane]> = [];

  const walk = (index: number, score: number) => {
    const remainingPossible = candidates.length - index;
    if (current.length + remainingPossible < bestCount) return;
    if (index === candidates.length) {
      if (current.length > bestCount || (current.length === bestCount && score > bestScore)) {
        bestCount = current.length;
        bestScore = score;
        bestPairs = [...current];
      }
      return;
    }
    const { hero, options } = candidates[index];
    for (const opt of options) {
      if (!used.has(opt.lane)) {
        used.add(opt.lane);
        current.push([hero.hero_id, opt.lane]);
        walk(index + 1, score + opt.weight);
        current.pop();
        used.delete(opt.lane);
      }
    }
    walk(index + 1, score);
  };
  walk(0, 0);

  const assignments = new Map<number, Lane>();
  const byLane: LaneAssignmentMap = { Clash: null, Jungle: null, Mid: null, Farm: null, Roam: null };
  for (const [heroId, lane] of bestPairs) {
    assignments.set(heroId, lane);
    byLane[lane] = heroId;
  }
  const occupiedLanes = new Set(bestPairs.map(([, lane]) => lane));
  const vacantLanes = new Set(ALL_LANES.filter(lane => !occupiedLanes.has(lane)));
  return { assignments, byLane, occupiedLanes, vacantLanes };
}

/** Maximum matching, so a flex hero never steals the sole lane of another hero. */
export function analyzeLaneOccupancy(
  heroes: Hero[],
  kplLaneRates?: KplLaneRateMap
): { occupiedLanes: Set<Lane>; vacantLanes: Set<Lane> } {
  const { occupiedLanes, vacantLanes } = assignHeroLanes(heroes, kplLaneRates);
  return { occupiedLanes, vacantLanes };
}

export interface TeamCompositionIntegrity {
  laneState: ReturnType<typeof assignHeroLanes>;
  displacedSupports: Hero[];
  duplicateRoamSupports: number;
  isFullCompWithoutMagicDamage: boolean;
}

/**
 * Flags unnatural Roam-Support displacement (for example pushing a Support out of Roam
 * into Mid or Clash just to fit a second Roam Support) and full drafts without a Mage/Mid carry.
 */
export function evaluateTeamCompositionIntegrity(
  heroes: Hero[],
  kplLaneRates?: KplLaneRateMap
): TeamCompositionIntegrity {
  const team = heroes.slice(0, 5);
  const laneState = assignHeroLanes(team, kplLaneRates);
  const displacedSupports = team.filter((hero) => {
    const isRoamSupport = hero.primary_role === 'Support' && hero.primary_lane === 'Roam';
    const assigned = laneState.assignments.get(hero.hero_id);
    return isRoamSupport && assigned !== undefined && assigned !== 'Roam';
  });
  const roamSupportsCount = team.filter(
    (hero) => hero.primary_role === 'Support' && hero.primary_lane === 'Roam'
  ).length;
  const duplicateRoamSupports = Math.max(0, roamSupportsCount - 1);
  const hasMidMagicCarry = team.some(
    (hero) => hero.primary_role === 'Mage' || hero.primary_lane === 'Mid'
  );
  return {
    laneState,
    displacedSupports,
    duplicateRoamSupports,
    isFullCompWithoutMagicDamage: team.length === 5 && !hasMidMagicCarry,
  };
}

/**
 * Computes empirical KPL pair delta, rewarding proven positive synergies (>= 20 matches, >= 50% WR)
 * and penalizing strongly negative anti-synergies (>= 15 matches, < 45% WR, lift <= -0.05).
 */
export function computeKplPairAdjustment(
  pairData: { matches?: number; win_rate?: number; synergy_lift?: number } | undefined,
  liftScale = 2.2,
  positiveBase = 0.35
): number {
  if (!pairData) return 0;
  const matches = pairData.matches ?? 0;
  const winRate = pairData.win_rate ?? 0.5;
  const lift = pairData.synergy_lift ?? 0;
  if (matches >= 20 && winRate >= 0.5) {
    return lift * liftScale + positiveBase;
  }
  if (matches >= 15 && winRate < 0.45 && lift <= -0.05) {
    return Math.max(-0.85, lift * liftScale);
  }
  return 0;
}
