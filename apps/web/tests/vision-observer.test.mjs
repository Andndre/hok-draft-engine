// DraftObserver tests: replays of synthetic DraftObservations onto the real
// tournament state machine (engine/draftRules), using the production dataset.
// Semantics: observations carry every region slot (empty ones as
// { heroId: null, abstained: false }); an EMPTY slot stops the replay cleanly
// while an UNIDENTIFIED (abstained) slot is a loud truncated failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DraftObserver, visionPhaseForStep, unidentifiedBansBreakdownMessage } from '../src/vision/observer.ts';
import { getDraftSequence } from '../src/engine/draftRules.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const allHeroes = read(manifest.artifacts.heroes.file);
// Deterministic pool of 18 distinct globally released heroes (the full tournament draft).
const heroes = [];
for (const hero of allHeroes) {
  if (hero.is_global_released === true && hero.hero_id !== 511 && !heroes.some(h => h.hero_id === hero.hero_id)) heroes.push(hero);
}
const H = heroes.slice(0, 18).map(h => h.hero_id);
assert.equal(H.length, 18, 'dataset must expose at least 18 distinct global heroes');

const SEQUENCE = getDraftSequence('tournament');
const makeObserver = (overrides = {}) => new DraftObserver({ heroes, side: 'blue', ...overrides });
const slot = (index, side, kind, heroId, abstained = false, locked) => {
  const out = { index, side, kind, heroId, abstained };
  if (locked !== undefined) out.locked = locked;
  return out;
};
const observation = (slots, screen = 'draft') => ({ ts: 1730000000000, screen, slots, side: 'blue' });

/** Empty placeholder slots for every remaining sequence step, per the observation contract. */
function emptySlotsFrom(fromStep) {
  const out = [];
  for (let step = fromStep; step < SEQUENCE.length; step++) {
    const turn = SEQUENCE[step];
    out.push(slot(step, turn.side, turn.action, null, false));
  }
  return out;
}

/** Filled prefix of the sequence + empty placeholders for the rest (bans take H[0..7], picks take H[8..17]). */
function observationPrefix(actionCount) {
  const slots = [];
  let banIndex = 0;
  let pickIndex = 0;
  for (let step = 0; step < actionCount; step++) {
    const turn = SEQUENCE[step];
    slots.push(slot(step, turn.side, turn.action, H[turn.action === 'ban' ? banIndex++ : 8 + pickIndex++]));
  }
  return observation([...slots, ...emptySlotsFrom(actionCount)]);
}

test('replays 4 bans + 3 picks onto the tournament sequence in engine order', () => {
  const filled = [
    slot(0, 'blue', 'ban', H[0]), slot(1, 'blue', 'ban', H[1]),
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]), slot(5, 'red', 'pick', H[5]), slot(6, 'red', 'pick', H[6]),
  ];
  const result = makeObserver().ingest(observation([...filled, ...emptySlotsFrom(7)]));
  assert.equal(result.step, 7);
  // Healthy partial: the replay stops cleanly on the first visibly empty slot.
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.appliedActions, 7);
  assert.equal(result.changed, true);
  // Sequence: B0 ban, R0 ban, B1 ban, R1 ban, B pick, R pick, R pick
  assert.deepEqual(result.position.bans.blue, [H[0], H[1]]);
  assert.deepEqual(result.position.bans.red, [H[2], H[3]]);
  assert.deepEqual(result.position.picks.blue, [H[4]]);
  assert.deepEqual(result.position.picks.red, [H[5], H[6]]);
});

test('a partial but healthy observation stops cleanly on the first empty slot', () => {
  // Board right after step 2: two bans filled, every other region slot visibly empty.
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(2, 'blue', 'ban', null),
    slot(1, 'red', 'ban', H[1]), slot(3, 'red', 'ban', null),
    slot(4, 'blue', 'pick', null), slot(7, 'blue', 'pick', null), slot(8, 'blue', 'pick', null), slot(15, 'blue', 'pick', null), slot(16, 'blue', 'pick', null),
    slot(5, 'red', 'pick', null), slot(6, 'red', 'pick', null), slot(9, 'red', 'pick', null), slot(14, 'red', 'pick', null), slot(17, 'red', 'pick', null),
  ]));
  assert.equal(result.truncated, false, 'an in-progress draft is NORMAL, not truncated');
  assert.equal(result.error, undefined);
  assert.equal(result.step, 2);
  assert.equal(result.appliedActions, 2);
  assert.equal(result.phase, 'BAN1');
  assert.deepEqual(result.position.bans.blue, [H[0]]);
  assert.deepEqual(result.position.bans.red, [H[1]]);
  assert.deepEqual(result.position.picks.blue, []);
  assert.deepEqual(result.position.picks.red, []);
});

test('an unidentified BAN slot is a soft signal: ban replay stops, picks still apply, no loud truncation', () => {
  const filled = [
    slot(0, 'blue', 'ban', H[0]),
    slot(1, 'blue', 'ban', H[1], true), // occupied but unidentified ban
    slot(2, 'red', 'ban', H[2]),
    slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]), slot(5, 'red', 'pick', H[5]), slot(6, 'red', 'pick', H[6]),
  ];
  const result = makeObserver().ingest(observation([...filled, ...emptySlotsFrom(7)]));
  // Soft: the observation is NOT a loud truncated failure.
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.unidentifiedBans, 1);
  // The unidentified blue ban stops only the BAN portion: blue ban #2 is
  // unknown, so the later RED ban identity cannot be trusted either.
  assert.deepEqual(result.position.bans.blue, [H[0]]);
  assert.deepEqual(result.position.bans.red, [H[2]], 'red ban before the failure point still applies');
  // The pick part of the replay still applies.
  assert.deepEqual(result.position.picks.blue, [H[4]]);
  assert.deepEqual(result.position.picks.red, [H[5], H[6]]);
  assert.equal(result.appliedActions, 5);

  // heroId === null && abstained === true is the same unidentified case.
  const nullAbstained = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    slot(1, 'blue', 'ban', null, true),
    slot(1, 'red', 'ban', H[2]),
    slot(4, 'blue', 'pick', H[4]),
    slot(5, 'red', 'pick', H[5]),
    ...emptySlotsFrom(6),
  ]));
  assert.equal(nullAbstained.truncated, false);
  assert.equal(nullAbstained.unidentifiedBans, 1);
  assert.deepEqual(nullAbstained.position.picks.blue, [H[4]]);
  assert.deepEqual(nullAbstained.position.picks.red, [H[5]]);

  // Two unidentified bans report a count of 2 and keep the picks intact.
  const twoUnknown = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    slot(1, 'red', 'ban', H[2]),
    slot(2, 'blue', 'ban', null, true),
    slot(3, 'red', 'ban', null, true),
    slot(4, 'blue', 'pick', H[4]),
    slot(5, 'red', 'pick', H[5]),
    ...emptySlotsFrom(6),
  ]));
  assert.equal(twoUnknown.truncated, false);
  assert.equal(twoUnknown.unidentifiedBans, 2);
  assert.deepEqual(twoUnknown.position.picks.blue, [H[4]]);
  assert.deepEqual(twoUnknown.position.picks.red, [H[5]]);
});

test('an estimated ban (identified but weakly supported) is treated EXACTLY like an unidentified ban', () => {
  // Vision marks every surviving ban identity `estimated: true` (the padlock
  // overlay makes ban crops untrustworthy — a wrong ban id must never
  // silently remove a hero from the recommendation pool). The observer must
  // fold it into the same soft path as an abstained ban.
  const filled = [
    slot(0, 'blue', 'ban', H[0]),
    { index: 1, side: 'blue', kind: 'ban', heroId: H[1], score: 0.6, abstained: false, estimated: true },
    slot(2, 'red', 'ban', H[2]),
    slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]), slot(5, 'red', 'pick', H[5]), slot(6, 'red', 'pick', H[6]),
  ];
  const result = makeObserver().ingest(observation([...filled, ...emptySlotsFrom(7)]));
  // Soft: not a loud truncated failure, and the estimated hero is NOT applied.
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.unidentifiedBans, 1, 'the estimated ban counts in the soft unidentified-ban signal');
  assert.deepEqual(result.position.bans.blue, [H[0]], 'the trusted ban before it still applies');
  assert.deepEqual(result.position.bans.red, [H[2]], 'the estimated ban itself must NOT enter the position');
  assert.ok(!result.position.bans.blue.includes(H[1]) && !result.position.bans.red.includes(H[1]),
    'the estimated hero must not be excluded from the recommendation pool');
  assert.deepEqual(result.position.picks.blue, [H[4]]);
  assert.deepEqual(result.position.picks.red, [H[5], H[6]]);
  assert.equal(result.appliedActions, 5);

  // An estimated FIRST ban poisons later ban identities the same way an
  // unidentified one does (their sequence positions cannot be trusted).
  const firstEstimated = makeObserver().ingest(observation([
    { index: 0, side: 'blue', kind: 'ban', heroId: H[0], score: 0.6, abstained: false, estimated: true },
    slot(2, 'red', 'ban', H[2]),
    slot(4, 'blue', 'pick', H[4]),
    ...emptySlotsFrom(5),
  ]));
  assert.equal(firstEstimated.truncated, false);
  assert.deepEqual(firstEstimated.position.bans.blue, [], 'the estimated ban is not applied');
  assert.deepEqual(firstEstimated.position.bans.red, [], 'bans after an estimated ban are untrusted');
  assert.deepEqual(firstEstimated.position.picks.blue, [H[4]], 'picks still apply');
});

test('a ban identification WITHOUT the estimated marker still applies as before (back-compat)', () => {
  // Hand-built observations that do not carry `estimated` keep the
  // pre-existing "any identified ban applies" semantics.
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(1, 'blue', 'ban', H[1]),
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    ...emptySlotsFrom(4),
  ]));
  assert.equal(result.truncated, false);
  assert.equal(result.unidentifiedBans, 0);
  assert.deepEqual(result.position.bans.blue, [H[0], H[1]]);
  assert.deepEqual(result.position.bans.red, [H[2], H[3]]);
});

test('an unidentified PICK slot still truncates loudly (asymmetric, on purpose)', () => {
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(1, 'red', 'ban', H[1]),
    slot(2, 'blue', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]),
    slot(5, 'red', 'pick', null, true), // occupied but unidentified PICK
    slot(6, 'red', 'pick', H[6]),
    ...emptySlotsFrom(7),
  ]));
  assert.equal(result.truncated, true, 'a wrong pick guess is worse than a missing ban identity');
  assert.equal(result.error, 'unidentified hero in red pick slot 5');
  assert.equal(result.unidentifiedBans, 0);
  assert.equal(result.step, 5);
  assert.equal(result.appliedActions, 5);
  assert.deepEqual(result.position.picks.red, [], 'later slots must NOT be applied');
});

test('an unlocked, identified pick is a pre-selection hint: clean stop, never applied', () => {
  // locked: false + identified: "Pilih Dulu" hint the player can still change.
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(1, 'red', 'ban', H[1]),
    slot(2, 'blue', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]), // locked undefined: caller without badge info
    slot(5, 'red', 'pick', H[5], false, false), // pre-selection
    ...emptySlotsFrom(6),
  ]));
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.step, 5);
  assert.equal(result.appliedActions, 5);
  assert.deepEqual(result.position.picks.blue, [H[4]]);
  assert.deepEqual(result.position.picks.red, [], 'the pre-selection must NOT be applied');

  // Even an unidentified pre-selection stays soft (checked before abstained).
  const softUnknown = makeObserver().ingest(observation([
    slot(4, 'blue', 'pick', null, true, false),
    ...emptySlotsFrom(5),
  ]));
  assert.equal(softUnknown.truncated, false);
  assert.equal(softUnknown.error, undefined);
  assert.equal(softUnknown.appliedActions, 0);
});

test('a group without enough slots is a region-profile inconsistency, distinct from the abstained case', () => {
  // Only one blue ban slot exists while the sequence expects a second blue ban at step 2.
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
  ]));
  assert.equal(result.truncated, true);
  assert.equal(result.error, 'region profile has no blue ban slots');
  assert.equal(result.step, 2);
  assert.deepEqual(result.position.bans.blue, [H[0]]);
  assert.deepEqual(result.position.bans.red, [H[2]]);
});

test('rebuild-not-patch: a shorter observation SHRINKS the resulting position', () => {
  const observer = makeObserver();
  const full = observer.ingest(observationPrefix(7));
  assert.equal(full.step, 7);
  assert.equal(full.truncated, false);
  assert.deepEqual(full.position.picks.blue, [H[8]]);
  assert.deepEqual(full.position.picks.red, [H[9], H[10]]);

  const short = observer.ingest(observationPrefix(2));
  assert.ok(short.step < full.step, 'step must decrease');
  assert.equal(short.step, 2);
  assert.equal(short.changed, true);
  // The shorter observation is partial but healthy: a clean stop, not a failure.
  assert.equal(short.truncated, false);
  assert.equal(short.error, undefined);
  assert.deepEqual(short.position.picks.blue, [], 'picks must be removed by the rebuild');
  assert.deepEqual(short.position.picks.red, [], 'picks must be removed by the rebuild');
  assert.deepEqual(short.position.bans.blue, [H[0]]);
  assert.deepEqual(short.position.bans.red, [H[1]]);
});

test('an unknown hero id sets an error and leaves the position uncorrupted', () => {
  const observer = makeObserver();
  const result = observer.ingest(observation([slot(0, 'blue', 'ban', 999999)]));
  assert.equal(result.step, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.appliedActions, 0);
  assert.equal(result.error, 'unknown hero id 999999 at slot 0');
  assert.deepEqual(observer.position.bans.blue, []);
  assert.deepEqual(observer.position.picks.blue, []);
  assert.equal(observer.position.step, 0);
});

test('a legality violation surfaces as a rejected-action error and keeps the last valid position', () => {
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(1, 'blue', 'ban', H[0]), // duplicate ban
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
  ]));
  assert.equal(result.step, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.error, `rejected blue ban hero ${H[0]} at step 2`);
  assert.deepEqual(result.position.bans.blue, [H[0]]);
  assert.deepEqual(result.position.bans.red, [H[2]]);
});

test("slotOrder 'reverse' flips the within-group order; 'chronological' is the default", () => {
  // Same index->hero mapping under both orderings; the minimal empty pick slots
  // keep the stop clean without polluting the ban groups under either sort.
  const slots = [
    slot(0, 'blue', 'ban', H[0]), slot(1, 'blue', 'ban', H[1]),
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', null), slot(5, 'red', 'pick', null),
  ];
  const chronological = makeObserver().ingest(observation(slots));
  assert.equal(chronological.truncated, false);
  assert.deepEqual(chronological.position.bans.blue, [H[0], H[1]]);
  assert.deepEqual(chronological.position.bans.red, [H[2], H[3]]);
  const reversed = makeObserver({ slotOrder: 'reverse' }).ingest(observation(slots));
  assert.equal(reversed.truncated, false);
  assert.deepEqual(reversed.position.bans.blue, [H[1], H[0]]);
  assert.deepEqual(reversed.position.bans.red, [H[3], H[2]]);
});

test('ARRAY order (not slot.index) decides position: a non-UI chronological order must be honoured', () => {
  // Ranked reality: the left column's rows are ordered by ROLE, so the UI row
  // that filled FIRST can carry a LARGER index. The observation supplies the
  // red pick group in fill-time order: index 6 (UI row 2, filled first) before
  // index 5 (UI row 1, filled later). The observer must consume R1 = H[9] and
  // R2 = H[8] — sorting by index would produce exactly the wrong assignment.
  const result = makeObserver().ingest(observation([
    // 4 tournament bans + the first blue pick, all in sequence order.
    slot(0, 'blue', 'ban', H[0]), slot(1, 'red', 'ban', H[1]),
    slot(2, 'blue', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[8]),
    // Red pick group in NON-UI (chronological) order: bigger index first.
    slot(6, 'red', 'pick', H[9]), slot(5, 'red', 'pick', H[10]),
    // Remaining groups present as visibly empty placeholders (one per slot).
    slot(7, 'blue', 'pick', null), slot(8, 'blue', 'pick', null), slot(9, 'blue', 'pick', null),
    slot(7, 'red', 'pick', null), slot(8, 'red', 'pick', null), slot(9, 'red', 'pick', null),
  ]));
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.step, 7);
  assert.equal(result.appliedActions, 7);
  assert.deepEqual(result.position.picks.blue, [H[8]]);
  assert.deepEqual(result.position.picks.red, [H[9], H[10]], 'array order wins over slot.index');
});

test("slotOrder 'reverse' reverses the supplied array order within each group", () => {
  // With 'reverse' the CALLER supplies each group in reverse-chronological
  // order (empties first), so that after the within-group reversal the filled
  // prefix is consumed in sequence order again.
  const result = makeObserver({ slotOrder: 'reverse' }).ingest(observation([
    slot(2, 'blue', 'ban', H[2]), slot(0, 'blue', 'ban', H[0]),
    slot(3, 'red', 'ban', H[3]), slot(1, 'red', 'ban', H[1]),
    slot(7, 'blue', 'pick', null), slot(8, 'blue', 'pick', null), slot(9, 'blue', 'pick', null), slot(4, 'blue', 'pick', H[8]),
    slot(7, 'red', 'pick', null), slot(8, 'red', 'pick', null), slot(9, 'red', 'pick', null),
    slot(5, 'red', 'pick', H[10]), slot(6, 'red', 'pick', H[9]),
  ]));
  assert.equal(result.truncated, false);
  assert.deepEqual(result.position.bans.blue, [H[0], H[2]], 'blue ban array [idx2, idx0] reversed');
  assert.deepEqual(result.position.picks.blue, [H[8]]);
  assert.deepEqual(result.position.picks.red, [H[9], H[10]], 'red pick array [idx5, idx6] reversed');
});

test('a non-draft screen leaves the previous position untouched with changed === false', () => {
  const observer = makeObserver();
  observer.ingest(observationPrefix(7));
  const before = observer.position;
  const result = observer.ingest(observation([], 'unknown'));
  assert.equal(result.changed, false);
  assert.equal(result.truncated, false);
  assert.equal(result.appliedActions, 0);
  assert.equal(result.error, 'not a draft screen');
  assert.equal(result.step, 7);
  assert.equal(observer.position, before, 'position object must be untouched');
  assert.deepEqual(observer.position.picks.blue, [H[8]]);
});

test('phase values derive from the engine helpers for ban, pick, and complete steps', () => {
  const twoBans = makeObserver().ingest(observationPrefix(2));
  assert.equal(twoBans.phase, 'BAN1');
  assert.equal(twoBans.truncated, false, 'in-progress draft is a clean stop');
  assert.equal(makeObserver().ingest(observationPrefix(6)).phase, 'PICK1');
  assert.equal(makeObserver().ingest(observationPrefix(10)).phase, 'BAN2');
  assert.equal(makeObserver().ingest(observationPrefix(14)).phase, 'PICK2');
  const complete = makeObserver().ingest(observationPrefix(18));
  assert.equal(complete.step, 18);
  assert.equal(complete.truncated, false);
  assert.equal(complete.phase, 'COMPLETE');
  assert.equal(complete.position.picks.blue.length, 5);
  assert.equal(complete.position.picks.red.length, 5);
  assert.equal(complete.position.bans.blue.length, 4);
  assert.equal(complete.position.bans.red.length, 4);
  assert.equal(new Set([...complete.position.picks.blue, ...complete.position.picks.red, ...complete.position.bans.blue, ...complete.position.bans.red]).size, 18);
});

test('an observation containing every slot region for a complete 18-action draft finishes cleanly', () => {
  const result = makeObserver().ingest(observationPrefix(18));
  assert.equal(result.truncated, false);
  assert.equal(result.error, undefined);
  assert.equal(result.step, 18);
  assert.equal(result.appliedActions, 18);
  assert.equal(result.phase, 'COMPLETE');
});

test('reset clears the projection; visionPhaseForStep maps engine steps directly', () => {
  const observer = makeObserver();
  observer.ingest(observationPrefix(7));
  observer.reset();
  assert.equal(observer.position.step, 0);
  assert.equal(observer.lastResult, null);
  assert.equal(visionPhaseForStep(0), 'BAN1');
  assert.equal(visionPhaseForStep(4), 'PICK1');
  assert.equal(visionPhaseForStep(12), 'BAN2');
  assert.equal(visionPhaseForStep(18), 'COMPLETE');
  assert.equal(visionPhaseForStep(6, 'ranked'), 'PICK1');
  assert.equal(visionPhaseForStep(3, 'ranked'), 'BAN1');
});

// ---------------------------------------------------------------------------
// Ban breakdown: abstained vs estimated, reported separately (UI notice)
// ---------------------------------------------------------------------------

test('the result reports abstained and estimated bans separately while unidentifiedBans stays their union', () => {
  // The measured live case, generalised: 2 abstained bans (no identity at
  // all) + 3 estimated bans (identity survived as an estimate) + 1 trusted
  // ban (no estimated marker) that must count in NEITHER soft bucket.
  const result = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    slot(1, 'blue', 'ban', null, true),
    { index: 2, side: 'red', kind: 'ban', heroId: H[2], score: 0.6, abstained: false, estimated: true },
    { index: 3, side: 'red', kind: 'ban', heroId: H[3], score: 0.6, abstained: false, estimated: true },
    slot(4, 'blue', 'ban', null, true),
    { index: 5, side: 'red', kind: 'ban', heroId: H[5], score: 0.6, abstained: false, estimated: true },
    // Empty pick placeholders keep the replay stop clean (soft bans only).
    slot(4, 'blue', 'pick', null), slot(5, 'red', 'pick', null),
  ]));
  assert.equal(result.abstainedBans, 2);
  assert.equal(result.estimatedBans, 3);
  // The replay-facing total is unchanged in value: still the abstained OR
  // estimated union (the exact union the replay folds into the soft path).
  assert.equal(result.unidentifiedBans, 5);
  assert.equal(result.unidentifiedBans, result.abstainedBans + result.estimatedBans);
  assert.equal(result.truncated, false, 'unidentified bans are soft — picks/bans replay semantics unchanged');
  assert.deepEqual(result.position.bans.blue, [H[0]], 'the trusted ban still applies');
  assert.deepEqual(result.position.bans.red, [], 'estimated bans never enter the position');
});

test('unidentifiedBans keeps its exact old value in the pre-breakdown scenarios', () => {
  // Estimated-only (1 estimated, 0 abstained): total was 1 before the
  // breakdown existed and must stay 1.
  const estimated = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    { index: 1, side: 'blue', kind: 'ban', heroId: H[1], score: 0.6, abstained: false, estimated: true },
    slot(2, 'red', 'ban', H[2]),
    slot(3, 'red', 'ban', H[3]),
    slot(4, 'blue', 'pick', H[4]), slot(5, 'red', 'pick', H[5]), slot(6, 'red', 'pick', H[6]),
    ...emptySlotsFrom(7),
  ]));
  assert.equal(estimated.unidentifiedBans, 1);
  assert.equal(estimated.abstainedBans, 0);
  assert.equal(estimated.estimatedBans, 1);

  // Abstained-only (2 abstained, 0 estimated): total was 2 and must stay 2.
  const abstained = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]),
    slot(1, 'red', 'ban', H[2]),
    slot(2, 'blue', 'ban', null, true),
    slot(3, 'red', 'ban', null, true),
    slot(4, 'blue', 'pick', H[4]),
    slot(5, 'red', 'pick', H[5]),
    ...emptySlotsFrom(6),
  ]));
  assert.equal(abstained.unidentifiedBans, 2);
  assert.equal(abstained.abstainedBans, 2);
  assert.equal(abstained.estimatedBans, 0);

  // No soft bans at all: all three counters are zero.
  const clean = makeObserver().ingest(observation([
    slot(0, 'blue', 'ban', H[0]), slot(1, 'blue', 'ban', H[1]),
    slot(2, 'red', 'ban', H[2]), slot(3, 'red', 'ban', H[3]),
    ...emptySlotsFrom(4),
  ]));
  assert.equal(clean.unidentifiedBans, 0);
  assert.equal(clean.abstainedBans, 0);
  assert.equal(clean.estimatedBans, 0);

  // A non-draft screen short-circuits with zeroed counters.
  const notDraft = makeObserver().ingest(observation([], 'unknown'));
  assert.equal(notDraft.unidentifiedBans, 0);
  assert.equal(notDraft.abstainedBans, 0);
  assert.equal(notDraft.estimatedBans, 0);
});

test('unidentifiedBansBreakdownMessage states the estimated and abstained counts distinctly', () => {
  // All abstained: no identity to name, so no "perkiraan" fragment.
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 0, abstainedBans: 2 }),
    '2 ban tidak teridentifikasi — semua ban tetap di luar posisi draft',
  );
  // The measured live mix (4 estimated: Li Xin/Xuance/Dunshan/Arke; 2 abstained: Daji/Luna).
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 4, abstainedBans: 2 }),
    '4 ban teridentifikasi (perkiraan) · 2 ban tidak teridentifikasi — semua ban tetap di luar posisi draft',
  );
  // All estimated-but-identified: the "perkiraan" qualifier is mandatory.
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 4, abstainedBans: 0 }),
    '4 ban teridentifikasi (perkiraan) — semua ban tetap di luar posisi draft',
  );
  // Degenerate zero case still carries the no-ban-enters-the-position invariant.
  assert.equal(
    unidentifiedBansBreakdownMessage({ estimatedBans: 0, abstainedBans: 0 }),
    'semua ban tetap di luar posisi draft',
  );
});
