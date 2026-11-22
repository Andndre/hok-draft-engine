/**
 * Bridges a projected DraftPosition into the existing tournament inference
 * engine, mirroring the canonical call site in App.tsx `updateAiPredictions`
 * (same argument order, same options, same onlyGlobal/plan/fearless handling).
 * The repo's tournament invariants (e.g. the openerPenalty that keeps immobile
 * carries out of Blue B1) live inside runTournamentInference — they are called,
 * never re-implemented here.
 */

import type { DraftFormat, DuetPackageOption, Hero, TacticalVector } from '../types';
import { getDraftTurn, oppositeSide } from './draftRules';
import type { DraftPosition, Side } from './draftRules';
import { isHeroGlobalReleased } from '../data/heroReleaseStatus';
import { runTournamentInference } from './tournamentInference';
import { pickPhaseCandidates } from './draftSearch';
import type { TournamentPhaseStrategy, TournamentPredictionResult } from './tournamentInference';
import { visionPhaseForStep } from '../vision/observer';
import type { VisionPhase } from '../vision/observer';
import type { VisionSide } from '../vision/types';

/** Inputs for the vision recommendation; every optional field mirrors the App.tsx inference call. */
export interface VisionRecommendationInput {
  position: DraftPosition;
  heroes: Hero[];
  /** The side the user is playing (declared by the operator). */
  side: VisionSide;
  format?: DraftFormat;
  /** Game 7 Peak Showdown mode (ULTIMATE_BATTLE_SEQUENCE phases). */
  isUltimateBattle?: boolean;
  /** Jumlah ban per sisi pada mode ranked (3/4/5) — harus sama dengan board. */
  rankedBanCount?: 3 | 4 | 5;
  /** KPL synergy dataset in the exact shape App.tsx passes as `synergyData`. */
  synergyDb?: Record<string, any>;
  /** The user's Plan A opener id (active only while it is the user's pick turn). */
  planAId?: number | null;
  /** The user's Plan B opener id. */
  planBId?: number | null;
  /** Repo invariant default true: non-global heroes never influence or appear in advice. */
  onlyGlobal?: boolean;
  /** Per-side Fearless locks for the ongoing series. */
  fearless?: { blue: number[]; red: number[] };
}

/** One recommendation snapshot for the live advisor panel. */
export interface VisionRecommendation {
  /** Recommended hero ids for the acting side, best first. */
  heroIds: number[];
  /** The matching Hero objects for `heroIds` (resolved from `heroes`). */
  heroSuggestions: Hero[];
  step: number;
  phase: VisionPhase;
  /** True when the current step is a pick (as opposed to a ban). */
  isPickPhase: boolean;
  /** True when the user is the side acting on this step. */
  isUserTurn: boolean;
  /** The acting side of the current step, independent of the user ('blue' fallback when the draft is complete). */
  actingSide: VisionSide;
  /** Full scored recommendation entries (matching simulator's TacticalRadarPanel). */
  recommendations?: TournamentPredictionResult['recommendations'];
  /** Duet package recommendations for double-pick / synergy windows. */
  duetPackages?: DuetPackageOption[];
  /** Phase strategy metadata (openers, objective). */
  phaseStrategy?: TournamentPhaseStrategy;
  /** 7-axis tactical composition scores. */
  tacticalScores?: TacticalVector;
}

/**
 * Compute a pick recommendation for the acting side via runTournamentInference.
 * Opponent suggestions use public information, never the user's private plan.
 */
export function computeVisionRecommendation(input: VisionRecommendationInput): VisionRecommendation {
  const format: DraftFormat = input.format ?? 'tournament';
  const isUltimateBattle = input.isUltimateBattle ?? false;
  const turn = getDraftTurn(input.position.step, format, isUltimateBattle, input.rankedBanCount ?? 3);
  const userSide: Side = input.side;
  const actingSide = turn.side;
  const isPickPhase = turn.action === 'pick' && !turn.isComplete;
  const isUserTurn = !turn.isComplete && actingSide === userSide;
  const phase = visionPhaseForStep(input.position.step, format, isUltimateBattle);
  const base = { step: input.position.step, phase, isPickPhase, isUserTurn, actingSide };
  if (!isPickPhase) return { ...base, heroIds: [], heroSuggestions: [] };

  const enemySide: Side = oppositeSide(actingSide);
  const ourHeroIds = [...input.position.picks[actingSide]];
  const enemyHeroIds = [...input.position.picks[enemySide]];
  // App.tsx narrows bans to the acting side only during a ranked BAN turn; the
  // adapter returns early on ban turns, so at any pick turn all bans apply.
  const bannedHeroIds = [...input.position.bans.blue, ...input.position.bans.red];
  const fearless = input.fearless ?? { blue: [], red: [] };
  const onlyGlobalReleased = input.onlyGlobal ?? true;
  const result = runTournamentInference(
    ourHeroIds,
    enemyHeroIds,
    bannedHeroIds,
    [...fearless[actingSide]],
    isPickPhase,
    actingSide === 'blue',
    input.heroes,
    input.position.step,
    isUserTurn ? input.planAId ?? null : null,
    isUserTurn ? input.planBId ?? null : null,
    onlyGlobalReleased,
    input.synergyDb ?? {},
    [...fearless[enemySide]],
    format,
    input.isUltimateBattle ?? false,
    input.rankedBanCount ?? 3,
  );
  const used = new Set([...ourHeroIds, ...enemyHeroIds, ...bannedHeroIds]);
  const legalRecommendations = result.recommendations
    .filter(entry => (onlyGlobalReleased ? isHeroGlobalReleased(entry.hero) : true))
    .filter(entry => !used.has(entry.hero.hero_id));
  const actingHeroes = input.heroes.filter(hero => ourHeroIds.includes(hero.hero_id));
  const engineCandidates = pickPhaseCandidates(legalRecommendations, actingHeroes, input.synergyDb?.hero_lane_rates);
  const engineIds = new Set(engineCandidates.map(entry => entry.hero.hero_id));
  const orderedRecommendations = [
    ...engineCandidates,
    ...legalRecommendations.filter(entry => !engineIds.has(entry.hero.hero_id)),
  ];
  const heroSuggestions = orderedRecommendations.map(entry => entry.hero);
  return {
    ...base,
    heroIds: heroSuggestions.map(hero => hero.hero_id),
    heroSuggestions,
    recommendations: orderedRecommendations,
    duetPackages: result.duetPackages,
    phaseStrategy: result.phaseStrategy,
    tacticalScores: result.tacticalScores,
  };
}
