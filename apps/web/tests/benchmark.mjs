import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeLaneOccupancy, emptyPosition, getDraftTurn, IMMOBILE_OPENERS, isLegalHero } from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft } from '../src/engine/draftSearch.ts';
const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const options = process.argv.slice(2);
const argument = name => { const i = options.indexOf(name); return i < 0 ? null : options[i + 1]; };
const historical = argument('--historical') ? JSON.parse(readFileSync(resolve(argument('--historical')), 'utf8')) : null;
const limit = Number(argument('--limit') ?? 12);
const baseContext = (position, data = synergy) => ({ heroes, synergy: data, onlyGlobal: true, fearless: { blue: [], red: [] }, aiSide: getDraftTurn(position.step).side, aiPlan: { a: null, b: null } });
const find = name => { const hero = heroes.find(h => h.name === name); if (!hero) throw new Error(`Missing fixture hero ${name}`); return hero.hero_id; };
// Reviewed domain criteria are independent of the search's numerical evaluator.
const fixtures = [
  { name: 'B1 avoids immobile blind picks', position: { ...emptyPosition(), step: 4 }, check: hero => !IMMOBILE_OPENERS.has(hero.hero_id) },
  { name: 'B5 fills the missing Roam lane', position: { step: 16, picks: { blue: ['Allain', 'Jing', 'Lady Zhen', 'Marco Polo'].map(find), red: ['Dun', 'Augran', 'Liang', 'Lady Sun'].map(find) }, bans: { blue: [], red: [] } }, check: (hero, position) => analyzeLaneOccupancy([...heroes.filter(h => position.picks.blue.includes(h.hero_id)), hero]).occupiedLanes.size === 5 },
];
const summary = { fixtures: [], historical: null };
for (const fixture of fixtures) {
  const ctx = baseContext(fixture.position);
  const baseline = rankedCandidates(fixture.position, ctx)[0].hero;
  const search = searchDraft(fixture.position, ctx);
  const selected = heroes.find(h => h.hero_id === search.heroId);
  const row = { fixture: fixture.name, baseline: baseline.name, search: selected?.name, baseline_pass: fixture.check(baseline, fixture.position), search_pass: !!selected && fixture.check(selected, fixture.position), completed_depth: search.completedDepth, elapsed_ms: search.elapsedMs };
  summary.fixtures.push(row);
  if (!row.baseline_pass || !row.search_pass) process.exitCode = 1;
}
if (historical) {
  const rows = [];
  for (const sample of historical.positions.slice(0, limit)) {
    const ctx = baseContext(sample.position, historical.synergy);
    const baseline = rankedCandidates(sample.position, ctx)[0]?.hero.hero_id;
    const decision = searchDraft(sample.position, ctx);
    rows.push({ battle_id: sample.battle_id, date: sample.date, step: sample.position.step, expected: sample.expected_hero_id, baseline, search: decision.heroId, legal: decision.heroId !== null && isLegalHero(sample.position, decision.heroId, ctx), depth: decision.completedDepth, elapsed_ms: decision.elapsedMs });
  }
  summary.historical = {
    cutoff: historical.cutoff, training_battles: historical.training_battles, samples: rows.length,
    baseline_agreement: rows.filter(r => r.baseline === r.expected).length,
    search_agreement: rows.filter(r => r.search === r.expected).length,
    legal_decisions: rows.filter(r => r.legal).length,
    max_elapsed_ms: Math.max(...rows.map(r => r.elapsed_ms)), limitations: historical.limitations, rows,
  };
}
if (argument('--output')) writeFileSync(resolve(argument('--output')), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
