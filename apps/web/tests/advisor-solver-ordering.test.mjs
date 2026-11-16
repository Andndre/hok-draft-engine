/**
 * @file advisor-solver-ordering.test.mjs
 * @description Regresi untuk pengurutan SELURUH daftar rekomendasi oleh solver
 * Minimax (`searchDraft` dengan `orderCandidates` → `rootValues`).
 *
 * Yang dijaga di sini:
 *  1. `searchDraft` mengembalikan nilai per kandidat saat `orderCandidates`
 *     dinyalakan — dan NILAI TERTINGGI = keputusan solver (badge #1 konsisten).
 *  2. Tanpa `orderCandidates` tidak ada nilai dan tidak ada biaya tambahan
 *     (jalur lawan AI tidak pernah menyalakannya).
 *  3. `orderRecommendationsBySolver` mengurutkan daftar menurut nilai solver,
 *     tidak ada kandidat yang hilang/dobel, dan Plan A yang dikunci tetap #1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyPosition } from '../src/engine/draftRules.ts';
import { searchDraft } from '../src/engine/draftSearch.ts';
import { orderRecommendationsBySolver } from '../src/engine/advisorRanking.ts';
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
  aiSide: 'blue',
  aiPlan: { a: null, b: null },
};

const position = { ...emptyPosition(), step: 4 };

const buildSheet = (pos) =>
  runTournamentInference(
    pos.picks.blue,
    pos.picks.red,
    [...pos.bans.blue, ...pos.bans.red],
    [],
    true,
    pos.picks.blue.length === 0,
    heroes,
    pos.step,
    null,
    null,
    true,
    synergy,
    [],
    'tournament',
  );

test('searchDraft mengembalikan nilai per kandidat dan nilai tertinggi = keputusan solver', () => {
  const decision = searchDraft(position, context, {
    maxDepth: 3,
    width: 6,
    budgetMs: 6000,
    allowExtendedBudget: true,
    orderCandidates: true,
  });

  assert.ok(Array.isArray(decision.rootValues), 'rootValues harus ada saat orderCandidates aktif');
  assert.ok(decision.rootValues.length > 1, 'harus ada beberapa kandidatbernilai');

  const head = decision.rootValues.filter((entry) => entry.tier === 'head');
  const tail = decision.rootValues.filter((entry) => entry.tier === 'tail');
  assert.ok(head.length > 0, 'harus ada blok head (kandidat yang dihitung alpha-beta)');
  assert.ok(tail.length > 0, 'harus ada blok tail (kandidat di luar lebar cabang)');

  // Nilai tertinggi di blok head = hero yang dipilih solver.
  const best = head.reduce((a, b) => (b.value > a.value ? b : a));
  assert.equal(
    best.heroId,
    decision.heroId,
    'kandidat dengan nilai solver tertinggi harus sama dengan keputusan solver (badge #1)',
  );

  // Blok head selalu mendahului blok tail.
  const firstTailIndex = decision.rootValues.findIndex((entry) => entry.tier === 'tail');
  const lastHeadIndex = decision.rootValues.map((e) => e.tier).lastIndexOf('head');
  assert.ok(lastHeadIndex < firstTailIndex, 'blok head harus mendahului blok tail');

  // Setiap hero punya paling banyak satu nilai.
  const ids = decision.rootValues.map((entry) => entry.heroId);
  assert.equal(new Set(ids).size, ids.length, 'satu nilai per hero');
});

test('tanpa orderCandidates tidak ada nilai dan tidak ada biaya tambahan', () => {
  const plain = searchDraft(position, context, { maxDepth: 3, width: 6, budgetMs: 6000, allowExtendedBudget: true });
  assert.equal(plain.rootValues, undefined, 'jalur biasa tidak boleh mengisi rootValues');

  const withOrder = searchDraft(position, context, {
    maxDepth: 3,
    width: 6,
    budgetMs: 6000,
    allowExtendedBudget: true,
    orderCandidates: true,
  });
  assert.ok(
    withOrder.elapsedMs >= plain.elapsedMs,
    'pengurutan tidak boleh membuat pencarian lebih cepat (ia menambah kerja)',
  );
});

test('orderRecommendationsBySolver mengurutkan daftar menurut nilai solver tanpa kehilangan kandidat', () => {
  const list = buildSheet(position).recommendations;
  assert.ok(list.length > 8, 'butuh daftar yang cukup panjang');

  const values = [
    { heroId: list[3].hero.hero_id, value: 12, depth: 3, tier: 'head' },
    { heroId: list[0].hero.hero_id, value: 20, depth: 3, tier: 'head' },
    { heroId: list[1].hero.hero_id, value: 5, depth: 1, tier: 'tail' },
  ];
  const ordered = orderRecommendationsBySolver(list, values);

  assert.equal(ordered.length, list.length, 'tidak ada kandidat yang boleh hilang');
  assert.equal(new Set(ordered.map((rec) => rec.hero.hero_id)).size, list.length, 'tidak ada duplikat');
  assert.equal(ordered[0].hero.hero_id, list[0].hero.hero_id, 'nilai tertinggi harus di posisi pertama');
  assert.equal(ordered[1].hero.hero_id, list[3].hero.hero_id, 'blok head diurutkan nilai tertinggi');
  assert.equal(ordered[2].hero.hero_id, list[1].hero.hero_id, 'blok tail menyusul setelah blok head');
  // Kandidat tanpa nilai mengikuti dengan urutan relatif aslinya.
  const unscored = list.filter((rec) => !values.some((v) => v.heroId === rec.hero.hero_id)).map((rec) => rec.hero.hero_id);
  assert.deepEqual(
    ordered.slice(3).map((rec) => rec.hero.hero_id),
    unscored,
    'kandidat tanpa nilai solver mempertahankan urutan aslinya',
  );
});

test('Plan A yang dikunci tetap di posisi pertama dan daftar tanpa nilai tidak berubah', () => {
  const list = buildSheet(position).recommendations;
  const locked = list[4].hero.hero_id;
  const ordered = orderRecommendationsBySolver(
    list,
    [{ heroId: list[0].hero.hero_id, value: 99, depth: 3, tier: 'head' }],
    { lockedPlanHeroId: locked },
  );
  assert.equal(ordered[0].hero.hero_id, locked, 'Plan A yang dikunci harus tetap di posisi pertama');
  assert.equal(ordered.length, list.length, 'tidak ada kandidat yang boleh hilang');

  assert.equal(orderRecommendationsBySolver(list, undefined), list, 'tanpa nilai, daftar dikembalikan apa adanya');
  assert.equal(orderRecommendationsBySolver(list, null), list, 'tanpa nilai, daftar dikembalikan apa adanya');
  assert.equal(orderRecommendationsBySolver(list, []), list, 'tanpa nilai, daftar dikembalikan apa adanya');
});
