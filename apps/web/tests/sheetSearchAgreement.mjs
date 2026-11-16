/**
 * @file sheetSearchAgreement.mjs
 * @description Harness PENGUKURAN (read-only) untuk ketidaksepakatan antara dua mesin
 * rekomendasi "top pick" pada posisi draft yang sama:
 *
 *  - LEMBAR REKOMENDASI (sheet): `runTournamentInference(...)` -> `recommendations[0]`
 *    (persis yang dipakai `App.tsx` untuk "Rekomendasi #1").
 *  - PENCARIAN MINIMAX (search): `searchDraft(...)` -> `heroId` (mesin yang dipakai
 *    lawan AI dan Web Worker).
 *
 * Modul ini TIDAK mengubah perilaku mesin. Ia hanya:
 *  1. menghasilkan posisi draft legal dengan mensimulasikan draft memakai
 *     `emptyPosition` / `getDraftTurn` / `applyDraftAction` / `rankedCandidates`,
 *  2. membandingkan top-1 kedua mesin di setiap langkah pick,
 *  3. merangkum angka agreement, gap skor, ketidaksepakatan terbesar, statistik
 *     planned opener, dan clustering Support/Roam.
 *
 * Jalankan langsung (laporan JSON ke stdout):
 *   cd apps/web
 *   node --import ./tests/register.mjs tests/sheetSearchAgreement.mjs
 *
 * Opsi:
 *   --json-only     hanya JSON (default: ringkasan + JSON)
 *
 * `npm.cmd run benchmark` dan `tests/sheet-search-agreement.test.mjs` memakai
 * `measureSheetSearchAgreement(...)` dari modul ini sehingga angkanya identik.
 */
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  emptyPosition,
  getDraftTurn,
  applyDraftAction,
  oppositeSide,
} from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft, evaluatePosition, pickPhaseCandidates } from '../src/engine/draftSearch.ts';
import { rankRecommendationsByPosition } from '../src/engine/advisorRanking.ts';
import { runTournamentInference } from '../src/engine/tournamentInference.ts';

/** Langkah pick pada DRAFT_SEQUENCE turnamen (18 langkah). */
export const PICK_STEPS = [4, 5, 6, 7, 8, 9, 14, 15, 16, 17];

/** Label ringkas per langkah pick untuk laporan. */
export const PICK_STEP_LABELS = {
  4: 'B1',
  5: 'R1',
  6: 'R2',
  7: 'B2',
  8: 'B3',
  9: 'R3',
  14: 'R4',
  15: 'B4',
  16: 'B5',
  17: 'R5',
};

/**
 * Opsi pencarian yang DIPAKAI HARNESS.
 *
 * Pencarian default (`budgetMs` 1.500) melakukan iterative deepening dan di mesin ini
 * berhenti setelah depth 3 selesai (depth 4 tidak selesai dalam anggaran). Agar angka
 * bisa direproduksi lintas mesin dan dipakai sebagai lantai regresi, harness memakai
 * batas kedalaman yang pasti selesai: depth 3, width 8 (sama dengan default),
 * anggaran waktu besar supaya tidak pernah timeout. Ini merepresentasikan hasil
 * "pencarian yang selesai" — bukan perilaku baru.
 */
export const SEARCH_OPTIONS = { maxDepth: 3, width: 8, budgetMs: 60000 };

/** Offset kandidat per-trajektori supaya sampel tidak didominasi satu jalur draft. */
export const TRAJECTORY_OFFSETS = [0, 1, 3, 5];

/**
 * Posisi tambahan di luar simulasi: B1 "buta" tanpa ban — persis kasus yang
 * dilaporkan (sheet: Dunshan, search: Zhang Fei) dan bentuk posisi yang dipakai
 * test/benchmark yang sudah ada (`{ ...emptyPosition(), step: 4 }`).
 */
export const BLIND_B1_POSITION = { step: 4, picks: { blue: [], red: [] }, bans: { blue: [], red: [] } };

export function loadDataset() {
  const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
  const manifest = read('data_manifest.json');
  const heroes = read(manifest.artifacts.heroes.file);
  const synergy = read(manifest.artifacts.synergy.file);
  return { heroes, synergy };
}

/** Konteks dengan bentuk yang sama seperti `apps/web/tests/draft.test.mjs`. */
export function createContext(heroes, synergy, aiSide = 'red') {
  return {
    heroes,
    synergy,
    onlyGlobal: true,
    fearless: { blue: [], red: [] },
    aiSide,
    aiPlan: { a: null, b: null },
  };
}

/**
 * Panggilan lembar rekomendasi yang MIRROR `App.tsx` dan `rankedCandidates`:
 * tanpa Plan A/B (plan hanya dikirim ke sisi AI bila operator mengisinya).
 */
export function sheetInference(position, context) {
  const turn = getDraftTurn(position.step, context.format ?? 'tournament');
  const activeBans = context.format === 'ranked' && turn.action === 'ban'
    ? position.bans[turn.side]
    : [...position.bans.blue, ...position.bans.red];
  return runTournamentInference(
    position.picks[turn.side],
    position.picks[oppositeSide(turn.side)],
    activeBans,
    context.fearless[turn.side],
    turn.action === 'pick',
    turn.side === 'blue',
    context.heroes,
    position.step,
    null,
    null,
    context.onlyGlobal,
    context.synergy,
    context.fearless[oppositeSide(turn.side)],
    context.format ?? 'tournament'
  );
}

/**
 * Simulasikan satu draft legal penuh dan rekam posisi SEBELUM setiap langkah pick.
 * Ban memakai kandidat teratas (ban wajar); pick memakai offset kandidat per
 * trajektori supaya jalur draft berbeda-beda namun tetap deterministik.
 */
export function sampleTrajectory(heroes, synergy, offset, pickSteps = PICK_STEPS, banOffset = 0) {
  const context = createContext(heroes, synergy);
  let position = emptyPosition();
  const samples = [];
  while (true) {
    const turn = getDraftTurn(position.step, context.format ?? 'tournament');
    if (turn.isComplete) break;
    const candidates = rankedCandidates(position, context);
    if (candidates.length === 0) break;
    if (turn.action === 'pick') {
      if (pickSteps.includes(position.step)) samples.push(position);
      const choice = candidates[offset % candidates.length];
      position = applyDraftAction(position, { ...turn, heroId: choice.hero.hero_id }, context);
    } else {
      const choice = candidates[banOffset % candidates.length];
      position = applyDraftAction(position, { ...turn, heroId: choice.hero.hero_id }, context);
    }
  }
  return samples;
}

const positionKey = (position) =>
  `${position.step}:${position.picks.blue.join(',')}|${position.picks.red.join(',')}|${position.bans.blue.join(',')}|${position.bans.red.join(',')}`;

const isRoamSupport = (hero) => hero?.primary_role === 'Support' || hero?.primary_lane === 'Roam';

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
};

/**
 * Ukur satu posisi pick: top-1 sheet vs top-1 search, skor keduanya di masing-masing
 * sistem, alasan sheet, dan apakah pilihan sheet = planned opener sheet itu sendiri.
 */
export function measurePosition(position, heroes, synergy) {
  const context = createContext(heroes, synergy);
  const turn = getDraftTurn(position.step, context.format ?? 'tournament');
  const sheet = sheetInference(position, context);
  // Yang SEBENARNYA dilihat pengguna = kandidat yang consider mesin (lane/komposisi
  // disaring) lalu sisanya — sama persis dengan App.tsx. Sheet mentah bisa menyebut
  // hero yang lane-nya sudah penuh, jadi mengukur sheet mentah mengukur hal yang
  // tidak pernah tampil ke pengguna.
  const ourHeroes = heroes.filter((h) => position.picks[turn.side].includes(h.hero_id));
  const engineCandidates = pickPhaseCandidates(sheet.recommendations, ourHeroes, synergy?.hero_lane_rates);
  const engineIds = new Set(engineCandidates.map((r) => r.hero.hero_id));
  const laneOrdered = [...engineCandidates, ...sheet.recommendations.filter((r) => !engineIds.has(r.hero.hero_id))];
  // Urutan yang dilihat pengguna = lane-terfilter + urutan ulang oleh evaluator
  // posisi milik solver (lihat src/engine/advisorRanking.ts).
  const displayed = rankRecommendationsByPosition(laneOrdered, position, context, { lockedPlanHeroId: null });
  const sheetTop = displayed[0];

  const decision = searchDraft(position, context, SEARCH_OPTIONS);
  const searchTop = decision.heroId === null ? null : heroes.find((h) => h.hero_id === decision.heroId) ?? null;
  const sheetRowForSearchTop = searchTop
    ? sheet.recommendations.find((r) => r.hero.hero_id === searchTop.hero_id) ?? null
    : null;

  // Skor sisi-pencarian: evaluasi posisi 1 ply setelah pick, dari perspektif pemilih.
  // `evaluatePosition` adalah fungsi evaluasi yang dipakai minimax; memakai 1 ply
  // membuat nilai tiap kandidat bisa dibandingkan langsung di satuan yang sama.
  const searchEvalAfterPick = (heroId) => {
    if (!heroId) return null;
    const next = applyDraftAction(position, { ...turn, heroId }, context);
    if (next === position) return null;
    return evaluatePosition(next, context, turn.side);
  };
  const sheetTopEval = sheetTop ? searchEvalAfterPick(sheetTop.hero.hero_id) : null;
  const searchTopEval = searchTop ? searchEvalAfterPick(searchTop.hero_id) : null;

  const plannedOpener = sheet.phaseStrategy.plannedOpener;

  return {
    step: position.step,
    step_label: PICK_STEP_LABELS[position.step] ?? `step ${position.step}`,
    side: turn.side,
    position_key: positionKey(position),
    sheet_hero_id: sheetTop?.hero.hero_id ?? null,
    sheet_hero_name: sheetTop?.hero.name ?? null,
    sheet_choice_score: sheetTop?.choiceScore ?? null,
    sheet_reason_tag: sheetTop?.proComboTag ?? sheetTop?.laneTag ?? null,
    sheet_lane_tag: sheetTop?.laneTag ?? null,
    sheet_hero_role: sheetTop?.hero.primary_role ?? null,
    sheet_hero_lane: sheetTop?.hero.primary_lane ?? null,
    sheet_is_roam_support: isRoamSupport(sheetTop?.hero),
    search_hero_id: searchTop?.hero_id ?? null,
    search_hero_name: searchTop?.name ?? null,
    search_hero_role: searchTop?.primary_role ?? null,
    search_hero_lane: searchTop?.primary_lane ?? null,
    search_is_roam_support: isRoamSupport(searchTop),
    search_choice_score: sheetRowForSearchTop?.choiceScore ?? null,
    search_completed_depth: decision.completedDepth,
    search_engine_kind: decision.engineKind,
    search_eval_after_sheet_pick: sheetTopEval,
    search_eval_after_search_pick: searchTopEval,
    sheet_gap_choice_score:
      sheetTop && sheetRowForSearchTop ? sheetTop.choiceScore - sheetRowForSearchTop.choiceScore : null,
    search_eval_gap:
      sheetTopEval !== null && searchTopEval !== null ? searchTopEval - sheetTopEval : null,
    agree: Boolean(sheetTop && searchTop && sheetTop.hero.hero_id === searchTop.hero_id),
    planned_opener_id: plannedOpener?.hero_id ?? null,
    planned_opener_name: plannedOpener?.name ?? null,
    sheet_is_planned_opener: Boolean(plannedOpener && sheetTop && plannedOpener.hero_id === sheetTop.hero.hero_id),
    search_is_planned_opener: Boolean(plannedOpener && searchTop && plannedOpener.hero_id === searchTop.hero_id),
    both_roam_support: isRoamSupport(sheetTop?.hero) && isRoamSupport(searchTop),
  };
}

/**
 * Metrik utama: bangun sampel dari beberapa trajektori draft, ukur setiap posisi pick,
 * lalu rangkum agreement per langkah, distribusi gap skor, 5 ketidaksepakatan
 * terbesar, statistik planned opener, dan clustering Support/Roam.
 */
export function measureSheetSearchAgreement({
  heroes,
  synergy,
  offsets = TRAJECTORY_OFFSETS,
  pickSteps = PICK_STEPS,
  extraPositions = [BLIND_B1_POSITION],
} = {}) {
  const dataset = heroes && synergy ? { heroes, synergy } : loadDataset();
  const rows = [];
  const seen = new Set();
  let duplicates = 0;
  const record = (position) => {
    const key = positionKey(position);
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    rows.push(measurePosition(position, dataset.heroes, dataset.synergy));
  };
  for (const position of extraPositions) record(position);
  for (const offset of offsets) {
    // Ban ikut di-offset supaya setiap trajektori punya papan awal berbeda
    // (kalau ban selalu kandidat #1, semua trajektori berbagi B1 yang sama).
    for (const position of sampleTrajectory(dataset.heroes, dataset.synergy, offset, pickSteps, offset)) {
      record(position);
    }
  }

  const byStepMap = new Map();
  for (const row of rows) {
    const bucket = byStepMap.get(row.step) ?? { step: row.step, label: row.step_label, total: 0, agree: 0 };
    bucket.total += 1;
    if (row.agree) bucket.agree += 1;
    byStepMap.set(row.step, bucket);
  }
  const byStep = [...byStepMap.values()]
    .sort((a, b) => a.step - b.step)
    .map((b) => ({
      step: b.step,
      label: b.label,
      sample_size: b.total,
      agreements: b.agree,
      agreement_rate: b.total > 0 ? b.agree / b.total : null,
    }));

  const agreements = rows.filter((r) => r.agree).length;
  const disagreements = rows.filter((r) => !r.agree && r.sheet_hero_id !== null && r.search_hero_id !== null);

  const sheetGaps = disagreements.map((r) => r.sheet_gap_choice_score).filter((v) => v !== null);
  const evalGaps = disagreements.map((r) => r.search_eval_gap).filter((v) => v !== null);
  const absEvalGaps = evalGaps.map((v) => Math.abs(v));

  const worst = [...disagreements]
    .sort((a, b) => Math.abs(b.search_eval_gap ?? 0) - Math.abs(a.search_eval_gap ?? 0))
    .slice(0, 5)
    .map((r) => ({
      step: r.step,
      step_label: r.step_label,
      side: r.side,
      sheet_pick: r.sheet_hero_name,
      sheet_hero_id: r.sheet_hero_id,
      search_pick: r.search_hero_name,
      search_hero_id: r.search_hero_id,
      sheet_reason_tag: r.sheet_reason_tag,
      sheet_choice_score: r.sheet_choice_score,
      search_choice_score: r.search_choice_score,
      sheet_minus_search_choice_score: r.sheet_gap_choice_score,
      search_eval_gap: r.search_eval_gap,
      sheet_pick_is_planned_opener: r.sheet_is_planned_opener,
      planned_opener: r.planned_opener_name,
      sheet_pick_role_lane: `${r.sheet_hero_role}/${r.sheet_hero_lane}`,
      search_pick_role_lane: `${r.search_hero_role}/${r.search_hero_lane}`,
    }));

  const withOpener = rows.filter((r) => r.planned_opener_id !== null);
  const sheetDiffersFromOpener = withOpener.filter((r) => !r.sheet_is_planned_opener);
  const disagreementsWithOpener = disagreements.filter((r) => r.planned_opener_id !== null);

  return {
    sheet_search_agreement_rate: rows.length > 0 ? agreements / rows.length : null,
    sample_size: rows.length,
    agreements,
    disagreements: rows.length - agreements,
    by_step: byStep,
    duplicate_positions_skipped: duplicates,
    trajectories: offsets.length,
    search_options: SEARCH_OPTIONS,
    gap_distribution: {
      // Selisih skor sheet antara pick sheet dan pick search (satuan choiceScore sheet).
      sheet_choice_score: {
        median: quantile(sheetGaps, 0.5),
        p90: quantile(sheetGaps, 0.9),
        max: sheetGaps.length > 0 ? Math.max(...sheetGaps) : null,
      },
      // Selisih evaluasi sisi-pencarian (1 ply setelah pick, perspektif pemilih).
      // Positif = pick search dinilai lebih baik oleh evaluator minimax.
      search_eval: {
        median: quantile(evalGaps, 0.5),
        p90: quantile(evalGaps, 0.9),
        max: evalGaps.length > 0 ? Math.max(...evalGaps) : null,
        median_abs: quantile(absEvalGaps, 0.5),
        p90_abs: quantile(absEvalGaps, 0.9),
        max_abs: absEvalGaps.length > 0 ? Math.max(...absEvalGaps) : null,
      },
    },
    worst_disagreements: worst,
    planned_opener: {
      positions_with_planned_opener: withOpener.length,
      sheet_top_is_planned_opener: withOpener.length - sheetDiffersFromOpener.length,
      sheet_top_is_planned_opener_rate:
        withOpener.length > 0 ? (withOpener.length - sheetDiffersFromOpener.length) / withOpener.length : null,
      // Di posisi di mana sheet TIDAK memilih planned opener-nya sendiri, apakah ia setuju dgn search?
      agreement_when_sheet_differs_from_opener:
        sheetDiffersFromOpener.length > 0
          ? sheetDiffersFromOpener.filter((r) => r.agree).length / sheetDiffersFromOpener.length
          : null,
      // Di antara ketidaksepakatan: berapa kali pick sheet = planned opener (bonus +1.45 jadi penentu)?
      disagreements_where_sheet_pick_is_planned_opener: disagreementsWithOpener.filter((r) => r.sheet_is_planned_opener).length,
      disagreements_with_planned_opener: disagreementsWithOpener.length,
    },
    support_roam_clustering: {
      disagreements: disagreements.length,
      both_picks_roam_support: disagreements.filter((r) => r.both_roam_support).length,
      sheet_pick_roam_support: disagreements.filter((r) => r.sheet_is_roam_support).length,
      search_pick_roam_support: disagreements.filter((r) => r.search_is_roam_support).length,
      agreement_rate_when_sheet_pick_roam_support:
        rows.filter((r) => r.sheet_is_roam_support).length > 0
          ? rows.filter((r) => r.sheet_is_roam_support && r.agree).length /
            rows.filter((r) => r.sheet_is_roam_support).length
          : null,
      sheet_roam_support_positions: rows.filter((r) => r.sheet_is_roam_support).length,
    },
    positions: rows,
  };
}

/** Ringkasan teks pendek untuk stdout / log. */
export function formatSummary(summary) {
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const num = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
  const lines = [
    `agreement ${pct(summary.sheet_search_agreement_rate)} (${summary.agreements}/${summary.sample_size})`,
    `by step: ${summary.by_step.map((b) => `${b.label} ${pct(b.agreement_rate)} (${b.agreements}/${b.sample_size})`).join(' · ')}`,
    `sheet choiceScore gap: median ${num(summary.gap_distribution.sheet_choice_score.median)} · p90 ${num(summary.gap_distribution.sheet_choice_score.p90)} · max ${num(summary.gap_distribution.sheet_choice_score.max)}`,
    `search eval gap (1 ply): median ${num(summary.gap_distribution.search_eval.median)} · p90 ${num(summary.gap_distribution.search_eval.p90)} · max ${num(summary.gap_distribution.search_eval.max)}`,
    `sheet top = planned opener: ${summary.planned_opener.sheet_top_is_planned_opener}/${summary.planned_opener.positions_with_planned_opener} (${pct(summary.planned_opener.sheet_top_is_planned_opener_rate)})`,
    `disagreements where sheet pick = planned opener: ${summary.planned_opener.disagreements_where_sheet_pick_is_planned_opener}/${summary.planned_opener.disagreements_with_planned_opener}`,
    `disagreements both Roam/Support: ${summary.support_roam_clustering.both_picks_roam_support}/${summary.support_roam_clustering.disagreements}`,
  ];
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const summary = measureSheetSearchAgreement();
  if (!process.argv.includes('--json-only')) {
    console.log(formatSummary(summary));
  }
  console.log(JSON.stringify(summary, null, 2));
}
