import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPracticeSession, practiceContext, reducePractice } from '../src/engine/practiceState.ts';
import { getDraftTurn, oppositeSide } from '../src/engine/draftRules.ts';
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
