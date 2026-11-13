// computeVisionRecommendation tests: our/enemy mirroring, legality invariants,
// and the tournament opener rule, using the production dataset + synergy db.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeVisionRecommendation } from '../src/engine/visionAdapter.ts';
import { IMMOBILE_OPENERS, emptyPosition } from '../src/engine/draftRules.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const allHeroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const globalHeroes = [];
const nonGlobalHeroes = [];
for (const hero of allHeroes) {
  if (hero.hero_id === 511 || globalHeroes.concat(nonGlobalHeroes).some(h => h.hero_id === hero.hero_id)) continue;
  (hero.is_global_released === true ? globalHeroes : nonGlobalHeroes).push(hero);
}
assert.ok(globalHeroes.length >= 17, 'dataset must expose enough global heroes');
assert.ok(nonGlobalHeroes.length > 0, 'dataset must expose non-global heroes for the filter test');

// Deterministic distinct global hero ids, in dataset order.
const G = globalHeroes.map(h => h.hero_id);
const byLane = lane => globalHeroes.find(h => h.primary_lane === lane);
const call = (position, side, extra = {}) => computeVisionRecommendation({ position, heroes: allHeroes, side, synergyDb: synergy, ...extra });

test('our/enemy derivation is mirrored: occupied lanes constrain OUR side only', () => {
  const ourIds = ['Clash', 'Jungle', 'Mid', 'Farm'].map(byLane).filter(Boolean).map(h => h.hero_id);
  assert.equal(ourIds.length, 4, 'dataset must expose one global hero per lane');
  const pos = { step: 4, picks: { blue: ourIds, red: [] }, bans: { blue: [G[10]], red: [G[11]] } };

  const asBlue = call(pos, 'blue');
  assert.equal(asBlue.isUserTurn, true);
  assert.equal(asBlue.isPickPhase, true);
  assert.equal(asBlue.phase, 'PICK1');
  assert.equal(asBlue.actingSide, 'blue');
  assert.ok(asBlue.heroIds.length > 0);
  // Our side already occupies Clash/Jungle/Mid/Farm -> top advice must fill Roam.
  assert.equal(asBlue.heroSuggestions[0].primary_lane, 'Roam');

  // Same board seen from the red side: it is the opponent's turn, no advice.
  const asRed = call(pos, 'red');
  assert.equal(asRed.isUserTurn, false);
  assert.equal(asRed.actingSide, 'blue');
  assert.deepEqual(asRed.heroIds, []);
  assert.deepEqual(asRed.heroSuggestions, []);

  // At red's pick turn the SAME four heroes are now ENEMY picks: they must not
  // block our (red side's) vacant lanes, so a Farm-primary hero becomes advice.
  const redTurnPos = { step: 5, picks: { blue: ourIds, red: [] }, bans: { blue: [G[10]], red: [G[11]] } };
  const redTurn = call(redTurnPos, 'red');
  assert.equal(redTurn.isUserTurn, true);
  assert.ok(redTurn.heroIds.length > 0);
  assert.ok(redTurn.heroSuggestions.slice(0, 3).some(h => h.primary_lane === 'Farm'), 'enemy-occupied Farm must not block the mirrored user side');
  assert.notDeepEqual(asBlue.heroIds, redTurn.heroIds, 'the two orientations must produce different advice');
});

test('recommendations never contain an already picked or banned hero, and match suggestions', () => {
  const pos = {
    step: 15, // blue pick turn (5th blue pick)
    picks: { blue: G.slice(0, 4), red: G.slice(4, 9) },
    bans: { blue: G.slice(9, 13), red: G.slice(13, 17) },
  };
  const rec = call(pos, 'blue');
  assert.equal(rec.isUserTurn, true);
  assert.ok(rec.heroIds.length > 0);
  const used = new Set([...pos.picks.blue, ...pos.picks.red, ...pos.bans.blue, ...pos.bans.red]);
  for (const id of rec.heroIds) assert.equal(used.has(id), false, `recommended ${id} must be unused`);
  assert.deepEqual(rec.heroIds, rec.heroSuggestions.map(h => h.hero_id));
});

test('only globally released heroes appear in heroSuggestions', () => {
  const nonGlobalId = nonGlobalHeroes[0].hero_id;
  const pos = {
    step: 15,
    picks: { blue: G.slice(0, 4), red: [...G.slice(4, 8), nonGlobalId] },
    bans: { blue: G.slice(8, 12), red: G.slice(12, 16) },
  };
  const rec = call(pos, 'blue');
  assert.ok(rec.heroIds.length > 0);
  for (const hero of rec.heroSuggestions) {
    assert.equal(hero.is_global_released, true, `${hero.name} must be globally released`);
    assert.notEqual(hero.hero_id, 511);
  }
  assert.equal(rec.heroIds.includes(nonGlobalId), false);
});

test('opponent turns and ban turns yield no pick candidates for the user', () => {
  // Blue's ban turn (step 0): it IS the user's turn but no pick advice is due.
  const banTurn = call(emptyPosition(), 'blue');
  assert.equal(banTurn.isUserTurn, true);
  assert.equal(banTurn.isPickPhase, false);
  assert.equal(banTurn.phase, 'BAN1');
  assert.deepEqual(banTurn.heroIds, []);

  // Blue's pick turn seen from red: not the user's turn.
  const pos4 = { step: 4, picks: { blue: [], red: [] }, bans: { blue: [G[0], G[1]], red: [G[2], G[3]] } };
  const oppTurn = call(pos4, 'red');
  assert.equal(oppTurn.isUserTurn, false);
  assert.equal(oppTurn.actingSide, 'blue');
  assert.deepEqual(oppTurn.heroIds, []);

  // Completed draft: no advice either way.
  const done = call({ ...emptyPosition(), step: 18 }, 'blue');
  assert.equal(done.isUserTurn, false);
  assert.equal(done.phase, 'COMPLETE');
  assert.deepEqual(done.heroIds, []);
});

test('the tournament opener invariant holds: no immobile carry in a Blue B1 first pick', () => {
  const pos = { step: 4, picks: { blue: [], red: [] }, bans: { blue: [G[0], G[1]], red: [G[2], G[3]] } };
  const rec = call(pos, 'blue');
  assert.equal(rec.isUserTurn, true);
  assert.equal(rec.phase, 'PICK1');
  assert.ok(rec.heroIds.length > 0);
  for (const id of rec.heroIds) {
    assert.equal(IMMOBILE_OPENERS.has(id), false, `immobile opener ${id} must not be recommended at Blue B1`);
  }
});
