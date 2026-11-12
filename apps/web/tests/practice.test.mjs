import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPracticeSession, practiceContext, reducePractice } from '../src/engine/practiceState.ts';
import { getDraftTurn, getDoublePickWindow, oppositeSide } from '../src/engine/draftRules.ts';
import { rankedCandidates } from '../src/engine/draftSearch.ts';
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const dataset = { heroes: read(manifest.artifacts.heroes.file), synergy: read(manifest.artifacts.synergy.file), version: manifest.dataset_version, manifest };
function play(session) {
  const game = session.games[session.gameIndex];
  const turn = getDraftTurn(game.position.step);
  const aiSide = oppositeSide(session.config.playerSide);
  const candidate = rankedCandidates(game.position, { ...practiceContext(session, dataset), synergy: dataset.synergy, aiSide, aiPlan: game.aiPlan })[0];
  return reducePractice(session, { type: 'commit', tag: { sessionId: session.sessionId, revision: session.revision }, actor: turn.side === session.config.playerSide ? 'human' : 'ai', heroId: candidate.hero.hero_id }, dataset);
}
for (const side of ['blue', 'red']) test(`practice ${side}: full series, undo boundary, stale result and completed-game review`, () => {
  let session = createPracticeSession('fixture-' + side, { playerSide: side, fearless: true }, dataset);
  const originalDataset = structuredClone(dataset);
  const tag = { sessionId: session.sessionId, revision: session.revision };
  for (let i = 0; i < 7; i++) session = play(session);
  const undone = reducePractice(session, { type: 'undo' }, dataset);
  const actions = session.games[0].actions;
  const lastHumanIndex = actions.findLastIndex(action => action.side === side);
  assert.equal(undone.games[0].position.step, lastHumanIndex);
  assert.equal(getDraftTurn(undone.games[0].position.step).side, side);
  const stale = reducePractice(undone, { type: 'commit', tag, actor: 'ai', heroId: 556 }, dataset);
  assert.equal(stale, undone);
  session = undone;
  while (session.games[0].position.step < 18) session = play(session);
  assert.equal(session.games[0].traces.length, 9);
  session = reducePractice(session, { type: 'next' }, dataset);
  assert.equal(session.gameIndex, 1);
  assert.equal(practiceContext(session, dataset).fearless.blue.length, 5);
  const viewing = reducePractice(session, { type: 'view', index: 0 }, dataset);
  assert.equal(reducePractice(viewing, { type: 'reset' }, dataset), viewing);
  assert.equal(reducePractice(viewing, { type: 'undo' }, dataset), viewing);
  const reset = reducePractice(session, { type: 'reset' }, dataset);
  assert.equal(reset.games[1].position.step, 0);
  assert.equal(reset.games[0].position.step, 18);
  assert.deepEqual(dataset, originalDataset, 'session never edits its dataset snapshot');
});
test('player Plan A/B is separate from the opponent plan', () => {
  const session = createPracticeSession('plan-test', { playerSide: 'blue', fearless: true }, dataset);
  const changed = reducePractice(session, { type: 'plan', plan: 'a', heroId: 556 }, dataset);
  assert.equal(changed.games[0].playerPlan.a, 556);
  assert.deepEqual(changed.games[0].aiPlan, session.games[0].aiPlan);
  assert.equal(changed.config.playerSide, 'blue');
});
test('duet commit spends both picks as one decision and undo removes both heroes together', () => {
  let session = createPracticeSession('duet-test', { playerSide: 'red', fearless: true }, dataset);
  while (session.games[0].position.step < 5) session = play(session);
  const game = session.games[0];
  assert.equal(game.position.step, 5, 'double-pick-first step reached');
  assert.equal(getDraftTurn(5).side, 'red');
  assert.equal(getDraftTurn(5).action, 'pick');
  assert.equal(getDoublePickWindow(5, 'tournament').isDoublePickFirst, true);

  const candidates = rankedCandidates(game.position, { ...practiceContext(session, dataset), synergy: dataset.synergy, aiSide: 'red', aiPlan: game.aiPlan, format: 'tournament' });
  const idA = candidates[0].hero.hero_id;
  const idB = candidates[1].hero.hero_id;
  assert.notEqual(idA, idB, 'duet needs two distinct heroes');
  assert.ok(!game.position.picks.red.includes(idA) && !game.position.picks.red.includes(idB));

  const actionsBefore = game.actions.length;
  const tracesBefore = game.traces.length;
  const committed = reducePractice(session, { type: 'commit-duet', tag: { sessionId: session.sessionId, revision: session.revision }, actor: 'human', heroIds: [idA, idB] }, dataset);
  const after = committed.games[0];
  assert.notEqual(committed, session);
  assert.equal(after.position.step, 7, 'both picks advance two steps');
  assert.ok(after.position.picks.red.includes(idA));
  assert.ok(after.position.picks.red.includes(idB));
  assert.equal(after.position.picks.red.length, game.position.picks.red.length + 2);
  assert.equal(after.actions.length, actionsBefore + 1, 'duet is a single action');
  const duetAction = after.actions[after.actions.length - 1];
  assert.equal(duetAction.side, 'red');
  assert.equal(duetAction.action, 'pick');
  assert.equal(duetAction.heroId, idA);
  assert.equal(duetAction.secondHeroId, idB);
  assert.equal(after.traces.length, tracesBefore + 1, 'duet is a single trace');
  const trace = after.traces[after.traces.length - 1];
  assert.equal(trace.heroId, idA);
  assert.equal(trace.partnerHeroId, idB);
  assert.equal(trace.actionIndex, actionsBefore);
  assert.ok(trace.alternatives.length > 0);
  assert.ok(trace.alternatives.every(alternative => alternative.heroId !== idA && alternative.heroId !== idB), 'alternatives exclude both chosen heroes');

  const undone = reducePractice(committed, { type: 'undo' }, dataset);
  const back = undone.games[0];
  assert.equal(back.position.step, 5, 'undo restores the double-pick-first step');
  assert.ok(!back.position.picks.red.includes(idA));
  assert.ok(!back.position.picks.red.includes(idB));
  assert.deepEqual(back.position, game.position, 'undo rebuilds the exact pre-duet position');
  assert.equal(back.actions.length, actionsBefore);
  assert.ok(!back.actions.some(action => action.secondHeroId !== undefined), 'duet action is removed');
  assert.equal(back.traces.length, tracesBefore, 'duet trace is removed');
  assert.ok(!back.traces.some(value => value.partnerHeroId !== undefined));

  const usedId = game.position.bans.blue[0] ?? game.position.bans.red[0] ?? game.position.picks.blue[0] ?? game.position.picks.red[0];
  assert.equal(typeof usedId, 'number', 'an unavailable hero exists for the atomicity probe');
  const rejectedSecondHero = reducePractice(session, { type: 'commit-duet', tag: { sessionId: session.sessionId, revision: session.revision }, actor: 'human', heroIds: [idA, usedId] }, dataset);
  assert.equal(rejectedSecondHero, session, 'illegal partner rejects the whole duet without partial application');

  const staleTag = reducePractice(session, { type: 'commit-duet', tag: { sessionId: session.sessionId, revision: session.revision + 1 }, actor: 'human', heroIds: [idA, idB] }, dataset);
  assert.equal(staleTag, session, 'stale revision rejects the duet');

  let banSession = createPracticeSession('duet-ban-test', { playerSide: 'red', fearless: true }, dataset);
  banSession = play(banSession);
  assert.equal(banSession.games[0].position.step, 1);
  assert.equal(getDraftTurn(1).action, 'ban');
  const rejectedOnBan = reducePractice(banSession, { type: 'commit-duet', tag: { sessionId: banSession.sessionId, revision: banSession.revision }, actor: 'human', heroIds: [idA, idB] }, dataset);
  assert.equal(rejectedOnBan, banSession, 'commit-duet is rejected outside a pick turn');
});
