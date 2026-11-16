/**
 * @file advisor-ranking.test.mjs
 * @description Regresi untuk `rankRecommendationsByPosition` (src/engine/advisorRanking.ts):
 * urutan rekomendasi yang dilihat pengguna harus mengikuti evaluator posisi milik
 * solver, Plan A/B yang dikunci user harus tetap didahulukan, dan daftar tidak boleh
 * kehilangan kandidat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyPosition, getDraftTurn, applyDraftAction } from '../src/engine/draftRules.ts';
import { pickPhaseCandidates, searchDraft, evaluatePosition } from '../src/engine/draftSearch.ts';
import { rankRecommendationsByPosition, promoteAdvisorPick } from '../src/engine/advisorRanking.ts';
import { runTournamentInference } from '../src/engine/tournamentInference.ts';

const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const context = {
  heroes,
  synergy,
  onlyGlobal: true,
  fearless: { blue: [], red: [] },
  aiSide: 'red',
  aiPlan: { a: null, b: null },
};

const buildSheet = (position) =>
  runTournamentInference(
    position.picks[position.picks.blue.length ? 'blue' : 'red'],
    position.picks[position.picks.blue.length ? 'red' : 'blue'],
    [...position.bans.blue, ...position.bans.red],
    [],
    true,
    position.picks.blue.length === 0,
    heroes,
    position.step,
    null,
    null,
    true,
    synergy,
    [],
    'tournament',
  );

const heroById = (id) => heroes.find((h) => h.hero_id === id);
const heroByName = (name) => heroes.find((h) => h.name === name);

test('advisor ranking re-orders by the solver position evaluation, not by sheet score', () => {
  const position = { ...emptyPosition(), step: 4 };
  const sheet = buildSheet(position);
  const laneOrdered = pickPhaseCandidates(sheet.recommendations, [], synergy.hero_lane_rates);
  const ranked = rankRecommendationsByPosition(laneOrdered, position, context, { lockedPlanHeroId: null });

  assert.equal(ranked.length, laneOrdered.length, 'tidak ada kandidat yang boleh hilang');

  // Kandidat #1 setelah re-rank harus punya evaluasi posisi tertinggi di antara
  // kandidat teratas yang diuji.
  const turn = getDraftTurn(position.step);
  const evaluated = ranked
    .slice(0, 8)
    .map((rec) => {
      const next = applyDraftAction(position, { ...turn, heroId: rec.hero.hero_id }, context);
      return next === position ? null : { rec, eval: evaluatePosition(next, context, turn.side) };
    })
    .filter(Boolean);
  const best = evaluated.reduce((a, b) => (b.eval > a.eval ? b : a));
  assert.equal(
    ranked[0].hero.hero_id,
    best.rec.hero.hero_id,
    'kandidat #1 harus yang skornya tertinggi menurut evaluator posisi',
  );
});

test('a user-locked plan is always ranked first', () => {
  const position = { ...emptyPosition(), step: 4 };
  const sheet = buildSheet(position);
  const laneOrdered = pickPhaseCandidates(sheet.recommendations, [], synergy.hero_lane_rates);
  const locked = laneOrdered[3]?.hero.hero_id;
  assert.ok(locked, 'butuh kandidat untuk dikunci');
  const ranked = rankRecommendationsByPosition(laneOrdered, position, context, { lockedPlanHeroId: locked });
  assert.equal(ranked[0].hero.hero_id, locked, 'Plan A yang dikunci harus tetap di posisi pertama');
});

test('advisor top-1 always fills a lane the team does not have yet', () => {
  // Solver depth-3 boleh memilih hero yang lane utamanya sudah terisi (penalti
  // lane-nya SOFT: -2,5 per lane duplikat), sedangkan advisor menyaring ketat
  // (lane utama yang belum terisi). Karena itu kesesuaian advisor-solver tidak
  // pernah 100% — dan yang dijamin advisor adalah-legalitas lane.
  const position = {
    step: 17,
    picks: { blue: [heroByName('Xiao Qiao').hero_id, heroByName('Dunshan').hero_id], red: [heroByName('Zhang Fei').hero_id, heroByName('Guan Yu').hero_id] },
    bans: { blue: [], red: [] },
  };
  const sheet = buildSheet(position);
  const ourTeam = position.picks.blue.map(heroById);
  const laneOrdered = pickPhaseCandidates(sheet.recommendations, ourTeam, synergy.hero_lane_rates);
  const ranked = rankRecommendationsByPosition(laneOrdered, position, context, { lockedPlanHeroId: null });
  const covered = new Set(ourTeam.map((h) => h.primary_lane));
  assert.ok(
    !covered.has(ranked[0].hero.primary_lane),
    `advisor #1 (${ranked[0].hero.name}, ${ranked[0].hero.primary_lane}) harus mengisi lane yang belum terisi (terisi: ${[...covered].join(', ')})`,
  );
});

test('promoteAdvisorPick moves the solver pick to the front and keeps the rest of the order', () => {
  const position = { ...emptyPosition(), step: 4 };
  const list = buildSheet(position).recommendations;
  assert.ok(list.length > 5, 'butuh daftar yang cukup panjang');
  const firstId = list[0].hero.hero_id;
  const targetId = list[4].hero.hero_id;

  const promoted = promoteAdvisorPick(list, targetId);

  assert.equal(promoted.length, list.length, 'tidak ada kandidat yang boleh hilang');
  assert.equal(promoted[0].hero.hero_id, targetId, 'pilihan solver harus di posisi pertama');
  const expectedRest = [...list.slice(0, 4), ...list.slice(5)].map((rec) => rec.hero.hero_id);
  assert.deepEqual(
    promoted.slice(1).map((rec) => rec.hero.hero_id),
    expectedRest,
    'sisa daftar mempertahankan urutan cepatnya',
  );
  assert.equal(list[0].hero.hero_id, firstId, 'daftar masukan tidak boleh dimutasi');
});

test('promoteAdvisorPick leaves the list untouched for null/unknown ids and for an already-first pick', () => {
  const position = { ...emptyPosition(), step: 4 };
  const list = buildSheet(position).recommendations;

  assert.equal(promoteAdvisorPick(list, null), list);
  assert.equal(promoteAdvisorPick(list, undefined), list);
  assert.equal(promoteAdvisorPick(list, -1), list);
  const unknown = heroes.find((h) => !list.some((rec) => rec.hero.hero_id === h.hero_id));
  assert.ok(unknown, 'butuh hero yang tidak ada di daftar');
  assert.equal(promoteAdvisorPick(list, unknown.hero_id), list);
  assert.equal(promoteAdvisorPick(list, list[0].hero.hero_id), list);
});
