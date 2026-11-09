import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRAFT_SEQUENCE, emptyPosition, getDraftTurn, applyDraftAction, isLegalHero, analyzeLaneOccupancy, IMMOBILE_OPENERS } from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft, evaluatePosition } from '../src/engine/draftSearch.ts';
import { evaluateTacticalScores, reviewedHoKStatsBonuses, runTournamentInference } from '../src/engine/tournamentInference.ts';
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
test('Fearless ban planning keeps own locked openers out and never wastes a recommendation on an enemy-locked hero', () => {
  const result = runTournamentInference([], [], [], [156], false, true, heroes, 0, 156, null, true, synergy, [556]);
  assert.ok(result.phaseStrategy.candidateOpeners.every(h => h.hero_id !== 156));
  assert.notEqual(result.phaseStrategy.plannedOpener?.hero_id, 156);
  assert.ok(result.recommendations.every(r => r.hero.hero_id !== 556));
  assert.ok(result.recommendations.some(r => r.hero.hero_id === 156), 'Own Fearless lock does not make a legal ban unavailable');
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
test('interrupted deepening retains the fully completed principal variation', () => {
  let ticks = 0;
  const ctx = context(), position = advance(emptyPosition(), ctx, 5);
  const result = searchDraft(position, ctx, { width: 4, maxDepth: 4, budgetMs: 120, now: () => ticks++ });
  assert.ok(result.completedDepth >= 1 && result.completedDepth < 4);
  assert.equal(result.principalVariation.length, result.completedDepth);
  assert.equal(result.heroId, result.principalVariation[0].heroId);
});
test('approved tactical tags improve role-only assessment without requiring every hero to have a profile', () => {
  const hero = heroes.find(h => h.primary_role === 'Mage');
  const baseline = evaluateTacticalScores([hero], []);
  const reviewed = { ...hero, tactical_profile: { tags: { frontline: true, suppress: true }, source_hash: 'fixture', model: 'fixture', reviewed_by: 'Fixture reviewer' } };
  const enriched = evaluateTacticalScores([reviewed], []);
  assert.ok(enriched.frontline_durability > baseline.frontline_durability);
  assert.ok(enriched.cc_chain_lockdown > baseline.cc_chain_lockdown);
});
test('HoKStats matchup and trait bonuses require Global release and review, and obey their caps', () => {
  const global = heroes.filter(h => h.is_global_released === true);
  const candidateBase = global.find(h => h.primary_role === 'Mage');
  const enemies = global.filter(h => h.hero_id !== candidateBase.hero_id).slice(0, 6);
  const approvedSource = { source: 'HoKStats', url: 'https://hokstats.gg/heroes/test/', fetched_at: '2026-11-09', patch_version: null, review_status: 'approved' };
  const pendingSource = { ...approvedSource, review_status: 'pending' };
  const allTags = { frontline: true, engage: true, peel: true, ally_shield: true, ally_heal: true, ally_move_speed_buff: true, ally_attack_speed_buff: true, ally_damage_buff: true, ally_cleanse: true, ally_cc_immunity: true };
  const matchups = enemies.map(enemy => ({ relation: 'strong_against', hero_id: enemy.hero_id, hero_name: enemy.name, evidence: 'editorial', source: approvedSource }));
  const candidate = { ...candidateBase, tactical_profile: { tags: allTags }, hokstats_guide: { matchups } };
  const bonuses = reviewedHoKStatsBonuses(candidate, [], enemies);
  assert.equal(bonuses.matchupBonus, 0.45);
  assert.equal(bonuses.traitBonus, 0.45);
  assert.equal(bonuses.totalBonus, 0.45, 'combined secondary signal stays below a direct +0.55 counter');
  assert.deepEqual(reviewedHoKStatsBonuses({ ...candidate, is_global_released: false }, [], enemies), { matchupBonus: 0, traitBonus: 0, totalBonus: 0 });
  const pending = { ...candidate, hokstats_guide: { matchups: matchups.map(m => ({ ...m, source: pendingSource })) } };
  assert.equal(reviewedHoKStatsBonuses(pending, [], enemies).matchupBonus, 0);
  const reverse = { ...candidate, hokstats_guide: { matchups: [] } };
  const counteredBy = enemies.map(enemy => ({ ...enemy, hokstats_guide: { matchups: [{ relation: 'countered_by', hero_id: candidate.hero_id, hero_name: candidate.name, evidence: 'editorial', source: approvedSource }] } }));
  assert.equal(reviewedHoKStatsBonuses(reverse, [], counteredBy).matchupBonus, 0.45);
  assert.deepEqual(reviewedHoKStatsBonuses({ ...candidateBase, hokstats_guide: { pros: ['Extremely durable tank'], cons: ['Can be kited'] } }, [], enemies), { matchupBonus: 0, traitBonus: 0, totalBonus: 0 });
  assert.ok(evaluateTacticalScores([candidate], []).team_utility >= 0 && evaluateTacticalScores([candidate], []).team_utility <= 1);
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
