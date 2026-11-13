import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getDraftSequence,
  getDraftPhases,
  getTournamentPhase,
  emptyPosition,
  getDraftTurn,
  applyDraftAction,
  isLegalHero,
  createInitialGameDraft,
  applyGameHero,
  IMMOBILE_OPENERS,
} from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft } from '../src/engine/draftSearch.ts';
import { runTournamentInference } from '../src/engine/tournamentInference.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const rankedContext = () => ({
  heroes,
  synergy,
  onlyGlobal: true,
  fearless: { blue: [], red: [] },
  aiSide: 'red',
  aiPlan: { a: null, b: null },
  format: 'ranked',
});

test('ranked draft sequence has 16 steps and 2 concise phases', () => {
  const seq = getDraftSequence('ranked');
  assert.equal(seq.length, 16);
  assert.deepEqual(seq.slice(0, 6), [
    { side: 'blue', action: 'ban' },
    { side: 'blue', action: 'ban' },
    { side: 'blue', action: 'ban' },
    { side: 'red', action: 'ban' },
    { side: 'red', action: 'ban' },
    { side: 'red', action: 'ban' },
  ]);
  assert.deepEqual(seq.slice(6), [
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
  ]);

  const phases = getDraftPhases('ranked');
  assert.equal(phases.length, 2);
  assert.equal(phases[0].id, 'RANKED_BAN');
  assert.equal(phases[0].start, 0);
  assert.equal(phases[0].end, 5);
  assert.equal(phases[1].id, 'RANKED_PICK');
  assert.equal(phases[1].start, 6);
  assert.equal(phases[1].end, 15);

  assert.equal(getTournamentPhase(0, 'ranked'), 'RANKED_BAN');
  assert.equal(getTournamentPhase(5, 'ranked'), 'RANKED_BAN');
  assert.equal(getTournamentPhase(6, 'ranked'), 'RANKED_PICK');
  assert.equal(getTournamentPhase(15, 'ranked'), 'RANKED_PICK');
  assert.equal(getTournamentPhase(16, 'ranked'), 'DRAFT_COMPLETE');
});

test('ranked blind ban allows overlapping bans across teams but blocks duplicate bans on same team', () => {
  const ctx = rankedContext();
  const augran = heroes.find(h => h.name === 'Augran');
  const liang = heroes.find(h => h.name === 'Liang');
  assert.ok(augran && liang);

  let pos = emptyPosition();
  // Step 0: Blue ban 1 -> Augran
  assert.equal(isLegalHero(pos, augran.hero_id, ctx, 'ranked'), true);
  pos = applyDraftAction(pos, { side: 'blue', action: 'ban', heroId: augran.hero_id }, ctx, 'ranked');
  assert.equal(pos.step, 1);
  assert.deepEqual(pos.bans.blue, [augran.hero_id]);

  // Step 1: Blue ban 2 -> Augran again must be ILLEGAL (same team cannot ban twice)
  assert.equal(isLegalHero(pos, augran.hero_id, ctx, 'ranked'), false);
  // Blue ban 2 -> Liang is legal
  assert.equal(isLegalHero(pos, liang.hero_id, ctx, 'ranked'), true);
  pos = applyDraftAction(pos, { side: 'blue', action: 'ban', heroId: liang.hero_id }, ctx, 'ranked');

  // Step 2: Blue ban 3
  const daQiao = heroes.find(h => h.name === 'Da Qiao');
  pos = applyDraftAction(pos, { side: 'blue', action: 'ban', heroId: daQiao.hero_id }, ctx, 'ranked');
  assert.equal(pos.step, 3);

  // Step 3: Red ban 1 -> Red CAN ban Augran too (blind ban overlap!)
  assert.equal(isLegalHero(pos, augran.hero_id, ctx, 'ranked'), true);
  pos = applyDraftAction(pos, { side: 'red', action: 'ban', heroId: augran.hero_id }, ctx, 'ranked');
  assert.deepEqual(pos.bans.red, [augran.hero_id]);

  // Step 4: Red ban 2 -> Red cannot ban Augran a second time
  assert.equal(isLegalHero(pos, augran.hero_id, ctx, 'ranked'), false);
});

test('banned heroes cannot be picked during ranked pick phase', () => {
  const ctx = rankedContext();
  const augran = heroes.find(h => h.name === 'Augran');
  let pos = emptyPosition();
  // Fast-forward 6 bans where Augran is banned by Blue
  pos.bans.blue = [augran.hero_id, 106, 107];
  pos.bans.red = [108, 109, 110];
  pos.step = 6; // B1 turn

  const turn = getDraftTurn(pos.step, 'ranked');
  assert.equal(turn.side, 'blue');
  assert.equal(turn.action, 'pick');

  // Augran was banned by Blue -> illegal to pick
  assert.equal(isLegalHero(pos, augran.hero_id, ctx, 'ranked'), false);
  // Hero 108 was banned by Red -> illegal to pick
  assert.equal(isLegalHero(pos, 108, ctx, 'ranked'), false);
  // Valid unbanned hero -> legal to pick
  const heino = heroes.find(h => h.name === 'Heino');
  assert.equal(isLegalHero(pos, heino.hero_id, ctx, 'ranked'), true);
});

test('full 16-action ranked draft completes with exactly 5 picks per team', () => {
  const ctx = rankedContext();
  let pos = emptyPosition();

  for (let i = 0; i < 16; i++) {
    const turn = getDraftTurn(pos.step, 'ranked');
    assert.equal(turn.isComplete, false);
    const candidates = rankedCandidates(pos, ctx);
    assert.ok(candidates.length > 0, `candidates should exist at step ${i}`);
    const chosen = candidates[0].hero;
    pos = applyDraftAction(pos, { side: turn.side, action: turn.action, heroId: chosen.hero_id }, ctx, 'ranked');
  }

  assert.equal(pos.step, 16);
  assert.equal(getDraftTurn(pos.step, 'ranked').isComplete, true);
  assert.equal(pos.picks.blue.length, 5);
  assert.equal(pos.picks.red.length, 5);
  assert.equal(pos.bans.blue.length, 3);
  assert.equal(pos.bans.red.length, 3);
  // 10 distinct picks across both teams
  assert.equal(new Set([...pos.picks.blue, ...pos.picks.red]).size, 10);
});

test('createInitialGameDraft creates 3 ban slots for ranked and 4 for tournament', () => {
  const rankedGame = createInitialGameDraft('ranked');
  assert.equal(rankedGame.blueBans.length, 3);
  assert.equal(rankedGame.redBans.length, 3);
  assert.equal(rankedGame.bluePicks.length, 5);
  assert.equal(rankedGame.redPicks.length, 5);

  const tourneyGame = createInitialGameDraft('tournament');
  assert.equal(tourneyGame.blueBans.length, 4);
  assert.equal(tourneyGame.redBans.length, 4);
});

test('at step 3 of ranked draft, a hero banned by blue remains legal and candidate for red', () => {
  const ctx = rankedContext();
  const augran = heroes.find(h => h.name === 'Augran');
  let pos = emptyPosition();
  pos.bans.blue = [augran.hero_id, 106, 107];
  pos.step = 3; // Red ban 1

  // isLegalHero without 4th argument should read context.format
  assert.equal(isLegalHero(pos, augran.hero_id, ctx), true);

  const candidates = rankedCandidates(pos, ctx);
  const augranCand = candidates.find(c => c.hero.hero_id === augran.hero_id);
  assert.ok(augranCand, 'Augran must remain a candidate for Red even if Blue already banned him');
});
