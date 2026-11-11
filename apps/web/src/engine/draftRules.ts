import type { DraftFormat, GameDraftData, Hero, KplLaneRate, Lane, LaneAssignmentMap, SeriesTeam } from '../types';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';

export type Side = 'blue' | 'red';
export type ActionKind = 'ban' | 'pick';
export type TournamentPhaseId = 'BAN_PHASE_1' | 'PICK_PHASE_1' | 'BAN_PHASE_2' | 'PICK_PHASE_2' | 'RANKED_BAN' | 'RANKED_PICK' | 'ULTIMATE_BATTLE' | 'DRAFT_COMPLETE';
export const IMMOBILE_OPENERS = new Set([112, 169, 142, 109, 504]);
export const FLOWBORN_HERO_IDS = new Set([581, 582, 583, 584, 585]);
export const isFlowborn = (heroId: number): boolean => FLOWBORN_HERO_IDS.has(heroId);
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

export const RANKED_DRAFT_SEQUENCE: ReadonlyArray<{ side: Side; action: ActionKind }> = [
  // 3 Blue Bans + 3 Red Bans (Blind / Simultan)
  { side: 'blue', action: 'ban' }, { side: 'blue', action: 'ban' }, { side: 'blue', action: 'ban' },
  { side: 'red', action: 'ban' }, { side: 'red', action: 'ban' }, { side: 'red', action: 'ban' },
  // 10 Picks
  { side: 'blue', action: 'pick' }, // B1
  { side: 'red', action: 'pick' },  // R1
  { side: 'red', action: 'pick' },  // R2
  { side: 'blue', action: 'pick' }, // B2
  { side: 'blue', action: 'pick' }, // B3
  { side: 'red', action: 'pick' },  // R3
  { side: 'red', action: 'pick' },  // R4
  { side: 'blue', action: 'pick' }, // B4
  { side: 'blue', action: 'pick' }, // B5
  { side: 'red', action: 'pick' },  // R5
];

export const ULTIMATE_BATTLE_SEQUENCE: ReadonlyArray<{ side: Side; action: ActionKind }> = [
  { side: 'blue', action: 'pick' }, { side: 'blue', action: 'pick' }, { side: 'blue', action: 'pick' }, { side: 'blue', action: 'pick' }, { side: 'blue', action: 'pick' },
  { side: 'red', action: 'pick' }, { side: 'red', action: 'pick' }, { side: 'red', action: 'pick' }, { side: 'red', action: 'pick' }, { side: 'red', action: 'pick' },
];

export const TOURNAMENT_PHASES = [
  { id: 'BAN_PHASE_1' as TournamentPhaseId, label: '1. Ban fase 1', sub: 'Lindungi opener', start: 0, end: 3, isBan: true },
  { id: 'PICK_PHASE_1' as TournamentPhaseId, label: '2. Pick fase 1', sub: 'Bentuk core tim', start: 4, end: 9, isBan: false },
  { id: 'BAN_PHASE_2' as TournamentPhaseId, label: '3. Ban fase 2', sub: 'Putus kombo lawan', start: 10, end: 13, isBan: true },
  { id: 'PICK_PHASE_2' as TournamentPhaseId, label: '4. Pick fase 2', sub: 'Lengkapi komposisi', start: 14, end: 17, isBan: false },
] as const;

export const RANKED_PHASES = [
  { id: 'RANKED_BAN' as TournamentPhaseId, label: '1. Blind Ban', sub: 'Tentukan 3 hero dilarang', start: 0, end: 5, isBan: true },
  { id: 'RANKED_PICK' as TournamentPhaseId, label: '2. Pemilihan Hero', sub: 'Bentuk komposisi tim', start: 6, end: 15, isBan: false },
] as const;

export const ULTIMATE_PHASES = [
  { id: 'ULTIMATE_BATTLE' as TournamentPhaseId, label: 'Ultimate Battle', sub: 'Blind Pick tanpa Ban (Boleh Mirror)', start: 0, end: 9, isBan: false },
] as const;

export const oppositeSide = (side: Side): Side => side === 'blue' ? 'red' : 'blue';

export function getDraftSequence(format: DraftFormat = 'tournament', isUltimateBattle: boolean = false): ReadonlyArray<{ side: Side; action: ActionKind }> {
  if (isUltimateBattle) return ULTIMATE_BATTLE_SEQUENCE;
  return format === 'ranked' ? RANKED_DRAFT_SEQUENCE : DRAFT_SEQUENCE;
}

export function getDraftPhases(format: DraftFormat = 'tournament', isUltimateBattle: boolean = false) {
  if (isUltimateBattle) return ULTIMATE_PHASES;
  return format === 'ranked' ? RANKED_PHASES : TOURNAMENT_PHASES;
}

export const getTournamentPhase = (step: number, format: DraftFormat = 'tournament', isUltimateBattle: boolean = false): TournamentPhaseId => {
  const phases = getDraftPhases(format, isUltimateBattle);
  return phases.find(p => step >= p.start && step <= p.end)?.id ?? 'DRAFT_COMPLETE';
};

export function getDraftTurn(step: number, format: DraftFormat = 'tournament', isUltimateBattle: boolean = false) {
  const sequence = getDraftSequence(format, isUltimateBattle);
  const turn = sequence[step];
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
  format?: DraftFormat;
  isUltimateBattle?: boolean;
}
export interface DraftAction { heroId: number; side: Side; action: ActionKind }
export const emptyPosition = (): DraftPosition => ({ step: 0, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } });

export function isLegalHero(
  position: DraftPosition,
  heroId: number,
  context: DraftContext,
  format: DraftFormat = context.format ?? 'tournament',
  isUltimateBattle: boolean = context.isUltimateBattle ?? false
): boolean {
  const turn = getDraftTurn(position.step, format, isUltimateBattle);
  const hero = context.heroes.find(h => h.hero_id === heroId);
  if (turn.isComplete || !hero || heroId === 511 || (context.onlyGlobal && !isHeroGlobalReleased(hero))) return false;

  const matchesHeroOrFlowborn = (id: number) => id === heroId || (isFlowborn(heroId) && isFlowborn(id));

  // Ultimate Battle (Game 7 Peak Showdown): No bans, full pool reset, mirror picks allowed across teams
  if (isUltimateBattle) {
    if (turn.action !== 'pick') return false;
    // Same team cannot pick the same hero twice (nor multiple Flowborn roles)
    return !position.picks[turn.side].some(matchesHeroOrFlowborn);
  }

  if (turn.action === 'ban') {
    if (format === 'ranked') {
      // In Ranked blind ban, opposing teams can ban the same hero, but the same team cannot ban it twice
      if (position.bans[turn.side].some(matchesHeroOrFlowborn)) return false;
      if (position.picks.blue.some(matchesHeroOrFlowborn) || position.picks.red.some(matchesHeroOrFlowborn)) return false;
      return true;
    }
    // Tournament ban: no duplicates across all bans/picks
    const allUsed = [...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red];
    if (allUsed.some(matchesHeroOrFlowborn)) {
      return false;
    }
    return true;
  }

  // Pick action: cannot pick any hero already picked or banned by either team
  const allUsed = [...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red];
  if (allUsed.some(matchesHeroOrFlowborn)) {
    return false;
  }
  return !context.fearless[turn.side].some(matchesHeroOrFlowborn);
}

export function applyDraftAction(
  position: DraftPosition,
  action: DraftAction,
  context: DraftContext,
  format: DraftFormat = context.format ?? 'tournament',
  isUltimateBattle: boolean = context.isUltimateBattle ?? false
): DraftPosition {
  const turn = getDraftTurn(position.step, format, isUltimateBattle);
  if (turn.side !== action.side || turn.action !== action.action || !isLegalHero(position, action.heroId, context, format, isUltimateBattle)) return position;
  const field = turn.action === 'pick' ? 'picks' : 'bans';
  return { ...position, step: position.step + 1, [field]: { ...position[field], [turn.side]: [...position[field][turn.side], action.heroId] } };
}

export const teamOnSide = (game: GameDraftData, side: Side): SeriesTeam =>
  side === 'blue' ? (game.blueTeam ?? 'A') : (game.blueTeam === 'A' ? 'B' : 'A');

export function computeSeriesFearlessLocks(
  games: Record<number, GameDraftData>,
  gameNumber: number,
  fearlessEnabled: boolean = true
): Record<Side, Set<number>> {
  if (!fearlessEnabled) return { blue: new Set<number>(), red: new Set<number>() };
  const curGame = games[gameNumber];
  // In Ultimate Battle, Fearless pool is completely reset
  if (curGame?.isUltimateBattle) {
    return { blue: new Set<number>(), red: new Set<number>() };
  }

  const byTeam: Record<SeriesTeam, Set<number>> = { A: new Set(), B: new Set() };
  for (let g = 1; g < gameNumber; g++) {
    const past = games[g];
    if (!past) continue;
    const bTeam = teamOnSide(past, 'blue');
    const rTeam = teamOnSide(past, 'red');
    past.bluePicks.forEach((h) => {
      if (!h) return;
      byTeam[bTeam].add(h.hero_id);
      if (isFlowborn(h.hero_id)) {
        FLOWBORN_HERO_IDS.forEach((fid) => byTeam[bTeam].add(fid));
      }
    });
    past.redPicks.forEach((h) => {
      if (!h) return;
      byTeam[rTeam].add(h.hero_id);
      if (isFlowborn(h.hero_id)) {
        FLOWBORN_HERO_IDS.forEach((fid) => byTeam[rTeam].add(fid));
      }
    });
  }

  const curBlueTeam = curGame ? teamOnSide(curGame, 'blue') : 'A';
  const curRedTeam = curGame ? teamOnSide(curGame, 'red') : 'B';
  return {
    blue: byTeam[curBlueTeam],
    red: byTeam[curRedTeam],
  };
}

export function findSeriesFearlessConflicts(
  games: Record<number, GameDraftData>,
  maxGame: number = 7
): Array<{ game: number; side: Side; heroId: number; heroName?: string }> {
  const conflicts: Array<{ game: number; side: Side; heroId: number; heroName?: string }> = [];
  const seenByTeam: Record<SeriesTeam, Map<number, number>> = { A: new Map(), B: new Map() };

  for (let g = 1; g <= maxGame; g++) {
    const game = games[g];
    if (!game || game.isUltimateBattle) continue;
    const bTeam = teamOnSide(game, 'blue');
    const rTeam = teamOnSide(game, 'red');

    for (const h of game.bluePicks) {
      if (!h) continue;
      const canonicalKey = isFlowborn(h.hero_id) ? 581 : h.hero_id;
      if (seenByTeam[bTeam].has(canonicalKey)) {
        conflicts.push({ game: g, side: 'blue', heroId: h.hero_id, heroName: h.name });
      } else {
        seenByTeam[bTeam].set(canonicalKey, g);
      }
    }
    for (const h of game.redPicks) {
      if (!h) continue;
      const canonicalKey = isFlowborn(h.hero_id) ? 581 : h.hero_id;
      if (seenByTeam[rTeam].has(canonicalKey)) {
        conflicts.push({ game: g, side: 'red', heroId: h.hero_id, heroName: h.name });
      } else {
        seenByTeam[rTeam].set(canonicalKey, g);
      }
    }
  }
  return conflicts;
}

export const createInitialGameDraft = (
  format: DraftFormat = 'tournament',
  blueTeam: SeriesTeam = 'A',
  isUltimateBattle: boolean = false
): GameDraftData => {
  const banSlots = isUltimateBattle ? 0 : (format === 'ranked' ? 3 : 4);
  return {
    bluePicks: Array(5).fill(null),
    redPicks: Array(5).fill(null),
    blueBans: Array(banSlots).fill(null),
    redBans: Array(banSlots).fill(null),
    draftStep: 0,
    bluePlanAId: null,
    bluePlanBId: null,
    redPlanAId: null,
    redPlanBId: null,
    blueTeam,
    winner: null,
    isUltimateBattle,
  };
};

export function toPosition(game: GameDraftData): DraftPosition {
  const ids = (xs: Array<Hero | null>) => xs.filter((h): h is Hero => h !== null).map(h => h.hero_id);
  return { step: game.draftStep, picks: { blue: ids(game.bluePicks), red: ids(game.redPicks) }, bans: { blue: ids(game.blueBans), red: ids(game.redBans) } };
}

export function applyGameHero(
  game: GameDraftData,
  hero: Hero,
  context: DraftContext,
  format: DraftFormat = context.format ?? 'tournament',
  isUltimateBattle: boolean = game.isUltimateBattle ?? false
): GameDraftData {
  const position = toPosition(game);
  const turn = getDraftTurn(position.step, format, isUltimateBattle);
  const next = applyDraftAction(position, { ...turn, heroId: hero.hero_id }, context, format, isUltimateBattle);
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

export function getPairEvidence(pairData: any): { eligible: boolean; lift: number; games: number; isRecent: boolean } {
  if (!pairData) return { eligible: false, lift: 0, games: 0, isRecent: false };
  const ev = pairData.evidence;
  if (ev) {
    const isEligible = Boolean(ev.is_active_meta || (ev.effective_games >= 12.0 && ev.recent_matches >= 8));
    return {
      eligible: isEligible,
      lift: typeof ev.lift === 'number' ? ev.lift : (pairData.synergy_lift ?? 0),
      games: ev.recent_matches ?? pairData.matches ?? 0,
      isRecent: (ev.recent_matches ?? 0) >= 8,
    };
  }
  // Fallback for legacy dataset
  const matches = pairData.matches ?? 0;
  const isEligible = matches >= 20;
  return {
    eligible: isEligible,
    lift: pairData.synergy_lift ?? 0,
    games: matches,
    isRecent: false,
  };
}

/**
 * Computes empirical KPL pair delta using evidence quality and recency weighting.
 */
export function computeKplPairAdjustment(
  pairData: { matches?: number; win_rate?: number; synergy_lift?: number; evidence?: any } | undefined,
  liftScale = 2.4,
  positiveBase = 0.30
): number {
  if (!pairData) return 0;
  const matches = pairData.matches ?? 0;
  const winRate = pairData.win_rate ?? 0.5;
  const rawLift = pairData.synergy_lift ?? 0;
  const evidence = getPairEvidence(pairData);

  // Positive synergy strictly requires active/eligible meta evidence
  if (evidence.eligible && evidence.lift > 0) {
    return evidence.lift * liftScale + positiveBase;
  }
  // Negative anti-synergies: penalize whenever matches >= 15 with poor win rate (< 45%)
  if (matches >= 15 && winRate < 0.45 && (rawLift <= -0.02 || evidence.lift < -0.02)) {
    const penaltyLift = evidence.lift < 0 ? evidence.lift : (winRate - 0.50);
    return Math.max(-0.85, penaltyLift * liftScale);
  }
  return 0;
}
