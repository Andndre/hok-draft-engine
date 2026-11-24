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
import { rankRecommendationsByPosition, enrichDuetPackagesWithMinimax } from '../src/engine/advisorRanking.ts';
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

test('urutan cepat (1-ply) tetap dipakai sebagai daftar cadangan saat solver belum menjawab', () => {
  // `promoteAdvisorPick` (promosi #1) sudah dihapus: urutannya digantikan
  // `orderRecommendationsBySolver` yang memakai nilai per kandidat (lihat
  // tests/advisor-solver-ordering.test.mjs). Yang tetap dijaga di sini adalah
  // urutan cadangan 1-ply: kandidat tidak boleh hilang dan Plan A terkunci
  // tetap di posisi pertama.
  const position = { ...emptyPosition(), step: 4 };
  const list = buildSheet(position).recommendations;
  const laneOrdered = pickPhaseCandidates(list, [], synergy.hero_lane_rates);
  const ranked = rankRecommendationsByPosition(laneOrdered, position, context, { lockedPlanHeroId: null });

  assert.equal(ranked.length, laneOrdered.length, 'tidak ada kandidat yang boleh hilang');
  assert.equal(new Set(ranked.map((rec) => rec.hero.hero_id)).size, laneOrdered.length, 'tidak ada duplikat');
});

test('enrichDuetPackagesWithMinimax integrates Principal Variation and position evaluation', () => {
  // Step 5 (R1): Red memulai jendela double pick R1+R2
  const position = {
    step: 5,
    picks: { blue: [heroByName("Ao'yin").hero_id], red: [] },
    bans: { blue: [], red: [] },
  };
  const heroesMap = new Map(heroes.map((h) => [h.hero_id, h]));
  const heroDun = heroByName('Dun');
  const heroLadySun = heroByName('Lady Sun');

  const heuristicDuet = {
    primaryHero: heroByName('Augran'),
    secondaryHero: heroByName('Dunshan'),
    combinedScore: 2.5,
    archetypeBadge: 'Frontline Anchor + Core Carry',
    primaryLane: 'Jungle',
    secondaryLane: 'Roam',
    windowLabel: 'Respon R1+R2',
  };

  const decision = {
    heroId: heroDun.hero_id,
    engineKind: 'search',
    completedDepth: 4,
    elapsedMs: 250,
    principalVariation: [
      { side: 'red', action: 'pick', heroId: heroDun.hero_id },
      { side: 'red', action: 'pick', heroId: heroLadySun.hero_id },
      { side: 'blue', action: 'pick', heroId: heroByName('Kaizer').hero_id },
      { side: 'blue', action: 'pick', heroId: heroByName('Liang').hero_id },
    ],
  };

  const enriched = enrichDuetPackagesWithMinimax(
    [heuristicDuet],
    decision,
    position,
    { ...context, aiSide: 'red' },
    heroesMap,
    synergy,
    'tournament'
  );

  assert.ok(enriched.length >= 1);
  // Paket #1 harus berasal dari PV Minimax
  const topDuet = enriched[0];
  assert.equal(topDuet.isSolverDuet, true, 'paket #1 harus ditandai sebagai pilihan Minimax');
  assert.equal(topDuet.primaryHero.hero_id, heroDun.hero_id);
  assert.equal(topDuet.secondaryHero.hero_id, heroLadySun.hero_id);
  assert.ok(topDuet.solverScore != null, 'harus memiliki nilai evaluasi posisi solver');
  assert.ok(topDuet.predictedResponses.length >= 1, 'harus memiliki prediksi respon lawan');
  assert.equal(topDuet.predictedResponses[0].hero_id, heroByName('Kaizer').hero_id);

  // Paket heuristik Augran + Dunshan juga harus mendapatkan solverScore dan predictedResponses
  const secondDuet = enriched.find((d) => d.primaryHero.name === 'Augran');
  if (secondDuet) {
    assert.ok(secondDuet.solverScore != null, 'paket kedua harus dievaluasi solverScore');
    assert.ok(Array.isArray(secondDuet.predictedResponses), 'paket kedua harus memiliki array predictedResponses');
    assert.ok(secondDuet.predictedResponses.length >= 1, 'paket kedua harus memiliki prediksi respon lawan');
  }
});
