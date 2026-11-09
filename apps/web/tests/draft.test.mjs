import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRAFT_SEQUENCE, emptyPosition, getDraftTurn, applyDraftAction, isLegalHero, analyzeLaneOccupancy, IMMOBILE_OPENERS } from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft, evaluatePosition } from '../src/engine/draftSearch.ts';
import { runTournamentInference } from '../src/engine/tournamentInference.ts';
import { matchesDecisionTag, OpponentClient } from '../src/engine/opponentClient.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const context = () => ({ heroes, synergy, onlyGlobal: true, fearless: { blue: [], red: [] }, aiSide: 'red', aiPlan: { a: null, b: null } });
function advance(position, ctx, count) {
  for (let i = 0; i < count; i++) {
    const heroId = rankedCandidates(position, ctx)[0]?.hero.hero_id;
    assert.ok(heroId, 'legal candidate should exist');
    position = applyDraftAction(position, { ...getDraftTurn(position.step), heroId }, ctx);
  }
  return position;
}
test('five Fearless games complete with legal Global rosters and no repeated team picks', () => {
  const ctx = context();
  for (let game = 0; game < 5; game++) {
    const position = advance(emptyPosition(), ctx, DRAFT_SEQUENCE.length);
    assert.equal(position.step, 18);
    assert.equal(position.picks.blue.length + position.picks.red.length, 10);
    assert.equal(position.bans.blue.length + position.bans.red.length, 8);
    assert.equal(new Set([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red]).size, 18);
    for (const side of ['blue', 'red']) {
      assert.equal(analyzeLaneOccupancy(heroes.filter(h => position.picks[side].includes(h.hero_id))).occupiedLanes.size, 5);
      assert.ok(position.picks[side].every(id => !ctx.fearless[side].includes(id)));
      ctx.fearless[side].push(...position.picks[side]);
    }
    const extra = applyDraftAction(position, { heroId: heroes[0].hero_id, side: 'blue', action: 'pick' }, ctx);
    assert.equal(extra, position);
  }
});
test('same validator rejects duplicates, wrong turns, CN heroes, and Ata alias', () => {
  const ctx = context(), position = emptyPosition();
  assert.equal(isLegalHero(position, 194, ctx), false);
  assert.equal(isLegalHero(position, 511, ctx), false);
  const id = rankedCandidates(position, ctx)[0].hero.hero_id;
  assert.equal(applyDraftAction(position, { heroId: id, side: 'red', action: 'ban' }, ctx), position);
  const next = applyDraftAction(position, { heroId: id, side: 'blue', action: 'ban' }, ctx);
  assert.equal(isLegalHero(next, id, ctx), false);
  ctx.fearless.blue.push(556);
  assert.equal(isLegalHero(position, 556, ctx), true, 'Fearless only restricts picks');
  assert.equal(isLegalHero({ ...position, step: 4 }, 556, ctx), false);
});
test('flex assignment reassigns an earlier hero to preserve all five lanes', () => {
  const base = heroes[0];
  const selected = [
    { ...base, primary_lane: 'Clash', lanes: ['Clash', 'Jungle'] },
    { ...base, primary_lane: 'Clash', lanes: ['Clash'] },
    ...['Mid', 'Farm', 'Roam'].map(lane => ({ ...base, primary_lane: lane, lanes: [lane] })),
  ];
  assert.equal(analyzeLaneOccupancy(selected).occupiedLanes.size, 5);
});
test('Liang direction, Ata mapping, and competitive opener restrictions remain intact', () => {
  const liang = heroes.find(h => h.name === 'Liang');
  assert.ok(liang.counters.some(c => c.target_id === 131), 'Liang counters Li Bai');
  assert.ok(liang.countered_by.some(c => c.counter_id === 182), 'Gan & Mo threatens Liang');
  assert.ok(heroes.some(h => h.hero_id === 556));
  assert.equal(heroes.some(h => h.hero_id === 511), false);
  for (const step of [0, 1, 2, 3, 4]) {
    const result = runTournamentInference([], [], [], [], step === 4, true, heroes, step, null, null, true, synergy);
    assert.ok(result.recommendations.every(r => !IMMOBILE_OPENERS.has(r.hero.hero_id)));
  }
});
test('minimax follows consecutive Red picks and completes bounded iterative deepening', () => {
  const ctx = context(), position = advance(emptyPosition(), ctx, 5);
  const result = searchDraft(position, ctx, { maxDepth: 3, width: 2 });
  assert.equal(result.completedDepth, 3);
  assert.deepEqual(result.principalVariation.map(a => a.side), ['red', 'red', 'blue']);
  let replay = position;
  for (const action of result.principalVariation) {
    const next = applyDraftAction(replay, action, ctx); assert.notEqual(next, replay); replay = next;
  }
  assert.equal(evaluatePosition(position, ctx, 'blue'), -evaluatePosition(position, ctx, 'red'));
});
test('deadline returns a legal deterministic baseline and never mutates the input', () => {
  const ctx = context(), position = emptyPosition(), before = structuredClone(position);
  const decision = searchDraft(position, ctx, { budgetMs: 0 });
  assert.equal(decision.completedDepth, 0);
  assert.equal(decision.engineKind, 'deterministic');
  assert.ok(isLegalHero(position, decision.heroId, ctx));
  assert.deepEqual(position, before);
});
test('stale worker responses cannot match another revision or session', () => {
  const tag = { sessionId: 'session-a', revision: 7 };
  assert.equal(matchesDecisionTag(tag, { ...tag, revision: 8 }), false);
  assert.equal(matchesDecisionTag(tag, { ...tag, sessionId: 'session-b' }), false);
  assert.equal(matchesDecisionTag(tag, { ...tag }), true);
});
test('worker failure uses local fallback and cancellation rejects pending requests', async () => {
  const dataset = { heroes, synergy }, ctx = context();
  const client = new OpponentClient(dataset, 'red');
  const result = await client.decide(emptyPosition(), ctx, { sessionId: 'fixture', revision: 0 }, new AbortController().signal);
  assert.equal(result.engineKind, 'deterministic'); // Node has no browser Worker.
  assert.ok(result.fallbackReason);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.decide(emptyPosition(), ctx, { sessionId: 'fixture', revision: 1 }, abort.signal), { name: 'AbortError' });
  client.cancel();
});
