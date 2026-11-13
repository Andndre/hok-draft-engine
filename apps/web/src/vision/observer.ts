/**
 * Folds a recognized DraftObservation into the EXISTING draft state machine.
 * Core invariant: REBUILD, NEVER PATCH — every ingest replays from a fresh
 * empty position, because the observed screen is ground truth and the
 * simulator state is only a projection of it. No draft rules live here; all
 * sequencing, legality, and phase logic is delegated to engine/draftRules.
 *
 * Observations must carry one SlotObservation per region profile slot,
 * including visibly empty ones; an empty slot stops the replay cleanly.
 *
 * UNIDENTIFIED SLOTS ARE NOT SYMMETRIC — ON PURPOSE:
 * - an unidentified PICK slot is a LOUD truncated failure (`truncated: true` +
 *   `error`): a wrong pick guess would poison the whole recommendation, so the
 *   observer refuses to guess past it;
 * - an unidentified BAN slot is a SOFT signal: it only stops the BAN portion
 *   of the replay (the ban identities after it are unknown — their sequence
 *   positions cannot be trusted), increments `unidentifiedBans`, and the PICK
 *   part of the replay still applies, because an unidentified ban is a lesser
 *   error (at worst one counter-hint is missing) than a wrong pick guess.
 * A wrong ban guess is a lesser error than a wrong pick guess, and the
 * observer treats them differently on purpose.
 *
 * ESTIMATED BANS ARE TREATED EXACTLY LIKE UNIDENTIFIED BANS: matcher scores
 * on the padlock-occluded 64px ban circles are not trustworthy (the measured
 * corpus contains a persistent false positive — Xuan Ce read as Ying at 0.60
 * with a 0.28 margin — and no ground truth to separate it from a correct
 * read), so every vision-produced ban identity carries `estimated: true` and
 * is folded into the same soft path: counted, the ban sequence position still
 * advances, picks still apply, and the hero is NOT applied to the position —
 * a weakly supported ban must never silently exclude a hero from the
 * recommendation pool.
 *
 * ORDERING CONTRACT: within each (side, kind) group the slots are consumed in
 * the order the CALLER supplies them (chronological fill order — the order
 * each slot became occupied on screen over time). The observer never sorts by
 * `slot.index`: on the HoK ranked board the left column's rows are ordered by
 * ROLE (Mid, Farm, Clash, Jungling, Roaming), not by pick order, so the UI
 * position is not the chronological position. The pipeline is responsible for
 * sorting each group by first-fill time before emitting (see
 * `sortSlotsChronologically` in pipeline.ts).
 */

import type { DraftFormat, Hero } from '../types';
import {
  applyDraftAction,
  emptyPosition,
  getDraftSequence,
  getTournamentPhase,
} from '../engine/draftRules';
import type { DraftContext, DraftPosition, TournamentPhaseId } from '../engine/draftRules';
import type { DraftObservation, SlotObservation, VisionSide } from './types';

/** Coarse draft phase in the vision vocabulary. */
export type VisionPhase = 'BAN1' | 'PICK1' | 'BAN2' | 'PICK2' | 'COMPLETE' | 'UNKNOWN';

/** Configuration for DraftObserver; `side` is the USER's side (advisory only — it never changes the replay). */
export interface ObserverOptions {
  heroes: Hero[];
  /** Which side the USER is on (declared manually by the operator). */
  side: VisionSide;
  format?: DraftFormat;
  /** Game 7 Peak Showdown mode (walks ULTIMATE_BATTLE_SEQUENCE instead). */
  isUltimateBattle?: boolean;
  /** Repo invariant default true: heroes not released globally must not influence the draft. */
  onlyGlobal?: boolean;
  /** Fearless locks for the ongoing series, per side. */
  fearless?: { blue: number[]; red: number[] };
  /**
   * Order in which slots of the same (side, kind) group are consumed, defined
   * against the ARRAY order the caller supplies (NOT against `slot.index`):
   * 'chronological' (default) consumes the array order as-is, 'reverse'
   * reverses the array order within each group. The caller is responsible for
   * supplying slots in chronological fill order.
   */
  slotOrder?: 'chronological' | 'reverse';
}

/** Result of one ingest. */
export interface ObserverResult {
  position: DraftPosition;
  step: number;
  phase: VisionPhase;
  /** True when the position differs from the previous ingest. */
  changed: boolean;
  /** True when the observed board could not be fully replayed because a PICK
   * slot was occupied but unidentified, a hero id was unknown, an action was
   * rejected, or the region profile is inconsistent — NOT merely because the
   * draft is still in progress (a partial but healthy observation stops
   * cleanly on the first visibly empty or pre-selection slot). An
   * unidentified BAN slot does NOT set this flag (see the module doc). */
  truncated: boolean;
  /** Human-readable reason the replay stopped abnormally (unidentified pick slot, unknown hero, rejected action, or region-profile inconsistency); undefined on a clean partial stop. */
  error?: string;
  /** Number of ban slots that were occupied but whose identity is not trusted (matcher abstained, or identified only as an estimate — see the module doc); the UI can say "N ban tidak teridentifikasi" (soft signal, see the module doc). */
  unidentifiedBans: number;
  /** Number of the `unidentifiedBans` ban slots the matcher ABSTAINED on (no identity at all); disjoint from `estimatedBans` and part of the same soft signal. */
  abstainedBans: number;
  /** Number of the `unidentifiedBans` ban slots whose identity only survived as an estimate (`estimated: true`); disjoint from `abstainedBans` and part of the same soft signal. */
  estimatedBans: number;
  /** Number of actions successfully applied during this ingest. */
  appliedActions: number;
}

/** Human-readable Indonesian fragment for the soft unidentified-ban signal. */
export function unidentifiedBansMessage(count: number): string {
  return `${count} ban tidak teridentifikasi`;
}

/** Indonesian one-line notice that separates estimated ban identities from abstained ones and states that NO ban identity ever enters the draft position. */
export function unidentifiedBansBreakdownMessage(breakdown: { estimatedBans: number; abstainedBans: number }): string {
  const parts: string[] = [];
  if (breakdown.estimatedBans > 0) parts.push(`${breakdown.estimatedBans} ban teridentifikasi (perkiraan)`);
  if (breakdown.abstainedBans > 0) parts.push(`${breakdown.abstainedBans} ban tidak teridentifikasi`);
  if (parts.length === 0) return 'semua ban tetap di luar posisi draft';
  return `${parts.join(' · ')} — semua ban tetap di luar posisi draft`;
}

/** Map the engine's own TournamentPhaseId onto the vision vocabulary. */
export function visionPhaseFromEnginePhase(phaseId: TournamentPhaseId): VisionPhase {
  switch (phaseId) {
    case 'BAN_PHASE_1':
    case 'RANKED_BAN':
      return 'BAN1';
    case 'PICK_PHASE_1':
    case 'RANKED_PICK':
    case 'ULTIMATE_BATTLE':
      return 'PICK1';
    case 'BAN_PHASE_2':
      return 'BAN2';
    case 'PICK_PHASE_2':
      return 'PICK2';
    case 'DRAFT_COMPLETE':
      return 'COMPLETE';
    default:
      return 'UNKNOWN';
  }
}

/** Vision phase for a draft step, derived from the engine's phase helpers (no hardcoded phase table). */
export function visionPhaseForStep(step: number, format: DraftFormat = 'tournament', isUltimateBattle: boolean = false): VisionPhase {
  return visionPhaseFromEnginePhase(getTournamentPhase(step, format, isUltimateBattle));
}

/** Replay-based observer projecting recognized board slots onto DraftPosition via applyDraftAction. */
export class DraftObserver {
  private readonly heroes: Hero[];
  private readonly knownHeroIds: Set<number>;
  private readonly side: VisionSide;
  private readonly format: DraftFormat;
  private readonly isUltimateBattle: boolean;
  private readonly onlyGlobal: boolean;
  private readonly fearless: { blue: number[]; red: number[] };
  private readonly slotOrder: 'chronological' | 'reverse';
  private currentPosition: DraftPosition;
  private lastResultValue: ObserverResult | null = null;

  constructor(options: ObserverOptions) {
    this.heroes = options.heroes;
    this.knownHeroIds = new Set(options.heroes.map(hero => hero.hero_id));
    this.side = options.side;
    this.format = options.format ?? 'tournament';
    this.isUltimateBattle = options.isUltimateBattle ?? false;
    this.onlyGlobal = options.onlyGlobal ?? true;
    this.fearless = { blue: [...(options.fearless?.blue ?? [])], red: [...(options.fearless?.red ?? [])] };
    this.slotOrder = options.slotOrder ?? 'chronological';
    this.currentPosition = emptyPosition();
  }

  /** Current projected position. */
  get position(): DraftPosition {
    return this.currentPosition;
  }

  /** Result of the most recent ingest, or null before the first call. */
  get lastResult(): ObserverResult | null {
    return this.lastResultValue;
  }

  /** Clear the projection back to an empty position. */
  reset(): void {
    this.currentPosition = emptyPosition();
    this.lastResultValue = null;
  }

  /** Rebuild the projected position from scratch out of one observation (never patches the previous state). */
  ingest(observation: DraftObservation): ObserverResult {
    if (observation.screen !== 'draft') {
      const result: ObserverResult = {
        position: this.currentPosition,
        step: this.currentPosition.step,
        phase: visionPhaseForStep(this.currentPosition.step, this.format, this.isUltimateBattle),
        changed: false,
        truncated: false,
        unidentifiedBans: 0,
        abstainedBans: 0,
        estimatedBans: 0,
        error: 'not a draft screen',
        appliedActions: 0,
      };
      this.lastResultValue = result;
      return result;
    }
    const previous = this.currentPosition;
    const queues = collectSlotQueues(observation.slots, this.slotOrder);
    const cursors = new Map<string, number>();
    const context: DraftContext = {
      heroes: this.heroes,
      onlyGlobal: this.onlyGlobal,
      fearless: { blue: [...this.fearless.blue], red: [...this.fearless.red] },
      format: this.format,
      isUltimateBattle: this.isUltimateBattle,
    };
    const sequence = getDraftSequence(this.format, this.isUltimateBattle);
    // Soft signal: EVERY ban circle that is occupied but not trusted,
    // counted across the whole observation (the UI can render "N ban tidak
    // teridentifikasi"). Not trusted = the matcher abstained OR the identity
    // only survived as an estimate (`estimated: true` — see the module doc).
    // The replay itself stops trusting ban identities from the first
    // untrusted one onwards (see bansUnknown below).
    let unidentifiedBans = 0;
    // Breakdown of the soft signal, reported separately so the UI can say
    // "N ban teridentifikasi (perkiraan) · M ban tidak teridentifikasi"
    // instead of a single misleading count: an estimated ban IS identified
    // (the panel shows its name with a "perkiraan" chip), while an abstained
    // one has no identity at all. Both stay OUTSIDE the position (see the
    // replay below); `unidentifiedBans` remains their union so the replay
    // semantics never change.
    let abstainedBans = 0;
    let estimatedBans = 0;
    for (const slot of observation.slots) {
      if (slot.kind !== 'ban') continue;
      if (slot.abstained || slot.estimated === true) unidentifiedBans += 1;
      if (slot.abstained) abstainedBans += 1;
      else if (slot.estimated === true) estimatedBans += 1;
    }
    let position = emptyPosition();
    let appliedActions = 0;
    let truncated = false;
    let error: string | undefined;
    // Set when a ban slot was occupied but unidentified: every later ban
    // identity is untrustworthy (its sequence position is unknown), but the
    // pick part of the replay must still apply.
    let bansUnknown = false;
    for (let step = 0; step < sequence.length; step += 1) {
      const turn = sequence[step];
      if (bansUnknown && turn.action === 'ban') {
        // Ban identities are untrusted from the failure point onwards, but
        // the sequence position is real: keep the projected step aligned so
        // the engine still validates the later pick turns.
        position = { ...position, step: position.step + 1 };
        continue;
      }
      const key = `${turn.side}:${turn.action}`;
      const queue = queues.get(key);
      const cursor = cursors.get(key) ?? 0;
      if (!queue || cursor >= queue.length) {
        // Contract: an observation carries one SlotObservation per region
        // profile slot, so an exhausted group means the profile/observation is
        // inconsistent — a calibration/config problem, not a healthy snapshot.
        truncated = true;
        error = `region profile has no ${turn.side} ${turn.action} slots`;
        break;
      }
      cursors.set(key, cursor + 1);
      const slot = queue[cursor];
      if (turn.action === 'pick' && slot.locked === false) {
        // Pre-selection hint ("Pilih Dulu"): the portrait is visible but the
        // team-coloured lock badge is absent, so the player can still change
        // it. Treat it as an uncommitted clean stop point — never as a made
        // pick (the position stays a committed prefix). This comes BEFORE the
        // abstained check on purpose: an unidentified pre-selection is also
        // uncommitted and must stay soft.
        break;
      }
      if (turn.action === 'ban' && (slot.abstained || slot.estimated === true)) {
        // Occupied ban whose identity is NOT trusted (matcher abstained, or
        // the identification only survived as an estimate): the lesser
        // error. Stop trusting the BAN portion (later ban identities are
        // unknown) — the count was taken across the whole observation — but
        // the pick part of the replay still applies. The sequence position
        // itself is known (the ban DID happen on screen), so the projected
        // step still advances past it; only the hero id stays unknown, and
        // an estimated ban never removes a hero from the recommendation.
        position = { ...position, step: position.step + 1 };
        bansUnknown = true;
        continue;
      }
      if (slot.abstained) {
        // Occupied but unidentified PICK: the dangerous case the UI must
        // surface loudly (a wrong pick guess would poison the recommendation).
        truncated = true;
        error = `unidentified hero in ${turn.side} ${turn.action} slot ${slot.index}`;
        break;
      }
      if (slot.heroId === null) {
        // Visibly EMPTY slot: the draft has simply not reached this action yet.
        // Clean stop — truncated stays false, no error.
        break;
      }
      if (!this.knownHeroIds.has(slot.heroId)) {
        truncated = true;
        error = `unknown hero id ${slot.heroId} at slot ${slot.index}`;
        break;
      }
      const next = applyDraftAction(
        position,
        { heroId: slot.heroId, side: turn.side, action: turn.action },
        context,
        this.format,
        this.isUltimateBattle,
      );
      if (next === position) {
        truncated = true;
        error = `rejected ${turn.side} ${turn.action} hero ${slot.heroId} at step ${step}`;
        break;
      }
      position = next;
      appliedActions += 1;
    }
    const result: ObserverResult = {
      position,
      step: position.step,
      phase: visionPhaseForStep(position.step, this.format, this.isUltimateBattle),
      changed: !samePosition(position, previous),
      truncated,
      unidentifiedBans,
      abstainedBans,
      estimatedBans,
      appliedActions,
    };
    if (error !== undefined) result.error = error;
    this.currentPosition = position;
    this.lastResultValue = result;
    return result;
  }
}

/** Group slots by (side, kind), PRESERVING the caller's array order: the
 * caller supplies each group in chronological fill order (see the ordering
 * contract on SlotObservation), and this function never re-sorts by
 * `slot.index` — UI position is not chronological on the ranked board.
 * `slotOrder === 'reverse'` reverses the array order within each group. */
function collectSlotQueues(slots: SlotObservation[], slotOrder: 'chronological' | 'reverse'): Map<string, SlotObservation[]> {
  const queues = new Map<string, SlotObservation[]>();
  for (const slot of slots) {
    const key = `${slot.side}:${slot.kind}`;
    const queue = queues.get(key);
    if (queue) queue.push(slot);
    else queues.set(key, [slot]);
  }
  if (slotOrder === 'reverse') {
    for (const queue of queues.values()) queue.reverse();
  }
  return queues;
}

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function samePosition(a: DraftPosition, b: DraftPosition): boolean {
  return a.step === b.step
    && sameIds(a.picks.blue, b.picks.blue)
    && sameIds(a.picks.red, b.picks.red)
    && sameIds(a.bans.blue, b.bans.blue)
    && sameIds(a.bans.red, b.bans.red);
}
