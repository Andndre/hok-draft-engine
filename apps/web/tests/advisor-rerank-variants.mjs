// Eksperimen: re-rank kandidat sheet dengan evaluasi posisi 1-ply (evaluator milik
// minimax) — seberapa menaikkan kesesuaian dengan pilihan search depth-3?
import {
  loadDataset,
  createContext,
  sheetInference,
  sampleTrajectory,
  SEARCH_OPTIONS,
  TRAJECTORY_OFFSETS,
  PICK_STEPS,
  BLIND_B1_POSITION,
} from './sheetSearchAgreement.mjs';
import { getDraftTurn, applyDraftAction } from '../src/engine/draftRules.ts';
import { searchDraft, evaluatePosition, pickPhaseCandidates } from '../src/engine/draftSearch.ts';

const { heroes, synergy } = loadDataset();

const positions = [BLIND_B1_POSITION];
for (const offset of TRAJECTORY_OFFSETS) {
  positions.push(...sampleTrajectory(heroes, synergy, offset, PICK_STEPS, offset));
}

const byStep = new Map();
const bump = (step, key) => {
  const m = byStep.get(step) ?? { total: 0, a: 0, b: 0, c: 0 };
  m.total++;
  m[key]++;
  byStep.set(step, m);
};
let agreeA = 0;
let agreeB = 0;
let agreeC = 0;
let agreeD = 0;
const rows = [];

for (const position of positions) {
  const context = createContext(heroes, synergy);
  const turn = getDraftTurn(position.step, context.format ?? 'tournament');
  const sheet = sheetInference(position, context);
  const ourHeroes = heroes.filter((h) => position.picks[turn.side].includes(h.hero_id));
  const engineCandidates = pickPhaseCandidates(sheet.recommendations, ourHeroes, synergy?.hero_lane_rates);
  const engineIds = new Set(engineCandidates.map((r) => r.hero.hero_id));
  const displayed = [...engineCandidates, ...sheet.recommendations.filter((r) => !engineIds.has(r.hero.hero_id))];
  const decision = searchDraft(position, context, SEARCH_OPTIONS);
  const searchTop = decision.heroId;
  const planned = sheet.phaseStrategy.plannedOpener?.hero_id ?? null;

  const scored = [];
  for (const rec of displayed.slice(0, 8)) {
    const next = applyDraftAction(position, { ...turn, heroId: rec.hero.hero_id }, context);
    if (next === position) continue;
    scored.push({ id: rec.hero.hero_id, name: rec.hero.name, eval: evaluatePosition(next, context, turn.side) });
  }
  scored.sort((a, b) => b.eval - a.eval);
  const best1ply = scored[0]?.id ?? null;

  const sheetTop = displayed[0]?.hero.hero_id ?? null;
  const variantB = planned != null && displayed.some((r) => r.hero.hero_id === planned) ? planned : best1ply;
  const withBonus = scored.map((s) => ({ ...s, eval: s.id === planned ? s.eval + 0.2 : s.eval }));
  withBonus.sort((a, b) => b.eval - a.eval);
  const variantC = withBonus[0]?.id ?? null;

  if (sheetTop === searchTop) { agreeA++; bump(position.step, 'a'); }
  if (best1ply === searchTop) { agreeB++; bump(position.step, 'b'); }
  if (variantB === searchTop) { agreeC++; bump(position.step, 'c'); }
  if (variantC === searchTop) agreeD++;

  rows.push({
    step: position.step,
    sheet: displayed[0]?.hero.name ?? '-',
    search: heroes.find((h) => h.hero_id === searchTop)?.name ?? '-',
    best1ply: scored[0]?.name ?? '-',
    margin: scored.length > 1 ? scored[0].eval - scored[1].eval : 0,
  });
}

const n = positions.length;
console.log(`sample: ${n} posisi pick\n`);
console.log(`(a) sheet #1 (tanpa filter lane)         : ${((agreeA / n) * 100).toFixed(1)}%  (${agreeA}/${n})`);
console.log(`(b) 1-ply re-rank                         : ${((agreeB / n) * 100).toFixed(1)}%  (${agreeB}/${n})`);
console.log(`(c) 1-ply re-rank + planned opener #1     : ${((agreeC / n) * 100).toFixed(1)}%  (${agreeC}/${n})`);
console.log(`(d) 1-ply re-rank + bonus opener 0,20     : ${((agreeD / n) * 100).toFixed(1)}%  (${agreeD}/${n})`);
console.log('\nper langkah (a=sheet, b=1ply, c=planned#1):');
for (const [step, m] of [...byStep.entries()].sort((x, y) => x[0] - y[0])) {
  console.log(
    `  step ${String(step).padStart(2)}  n=${m.total}  a ${((m.a / m.total) * 100).toFixed(0).padStart(3)}%  b ${((m.b / m.total) * 100).toFixed(0).padStart(3)}%  c ${((m.c / m.total) * 100).toFixed(0).padStart(3)}%`,
  );
}
console.log('\ncontoh yang berubah oleh re-rank:');
let shown = 0;
for (const r of rows) {
  if (r.sheet !== r.best1ply && shown < 10) {
    console.log(`  step ${String(r.step).padStart(2)}  sheet ${r.sheet.padEnd(16)} | 1ply ${r.best1ply.padEnd(16)} | search ${r.search.padEnd(16)} (margin ${r.margin.toFixed(2)})`);
    shown++;
  }
}
