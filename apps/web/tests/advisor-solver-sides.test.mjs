/**
 * @file advisor-solver-sides.test.mjs
 * @description Regresi jalur ADVISOR: rekomendasi utama sekarang datang dari solver
 * Minimax (`searchDraft`) untuk sisi mana pun yang sedang bergiliran.
 *
 * Yang dijaga di sini:
 *  1. `searchDraft` adalah mesin untuk BLUE dan RED — keputusan untuk giliran biru dan
 *     giliran merah sama-sama legal untuk sisi yang bergiliran (bukan hero yang sudah
 *     dipakai/di-ban).
 *  2. `aiPlan: { a: null, b: null }` benar-benar berarti TANPA pengaruh plan: keputusan
 *     tidak berubah oleh `aiSide`, dan plan sisi lawan tidak menyentuh keputusan.
 *  3. Plafon anggaran: default tetap `MAX_SEARCH_BUDGET_MS` (1.500 ms) dan hanya
 *     `allowExtendedBudget: true` yang membuka `MAX_ADVISOR_BUDGET_MS`.
 *  4. Protokol worker menerima `side` + `options` untuk jalur advisor dan tidak
 *     meneruskan plan pemain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { emptyPosition, getDraftTurn, applyDraftAction, isLegalHero, getTournamentPhase } from '../src/engine/draftRules.ts';
import {
  rankedCandidates,
  searchDraft,
  MAX_SEARCH_BUDGET_MS,
  MAX_ADVISOR_BUDGET_MS,
  BLIND_OPENER_MAX_DEPTH,
} from '../src/engine/draftSearch.ts';
import { OpponentClient } from '../src/engine/opponentClient.ts';
import { kplPresenceOf } from '../src/engine/tournamentInference.ts';

const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);

const dataset = {
  heroes,
  synergy,
  version: manifest.dataset_version,
  manifest,
};

/** Konteks pencarian; `aiPlan` selalu kosong kecuali test mengisinya sendiri. */
const makeContext = (aiSide, aiPlan = { a: null, b: null }) => ({
  heroes,
  synergy,
  onlyGlobal: true,
  fearless: { blue: [], red: [] },
  aiSide,
  aiPlan,
});

/** Papan B1 buta: tanpa pick, tanpa ban, giliran blue pick. */
const blindB1 = () => ({ ...emptyPosition(), step: 4 });

/** Papan R1: B1 diisi kandidat legal pertama, sehingga giliran menjadi red pick. */
const afterBlueFirstPick = () => {
  const position = blindB1();
  const context = makeContext('blue');
  const opener = rankedCandidates(position, context)[0];
  assert.ok(opener, 'butuh kandidat legal untuk first pick');
  return applyDraftAction(position, { side: 'blue', action: 'pick', heroId: opener.hero.hero_id }, context);
};

const FAST = { maxDepth: 2, width: 6, budgetMs: 500 };

test('ranked 4/5-ban drafts read the same turn sequence as the board', () => {
  // Mode ranked dengan 5 ban per sisi = 20 langkah; 3 ban = 16 langkah. Tanpa
  // `rankedBanCount` yang diteruskan, urutan 3 ban dipakai dan sejak langkah 6
  // giliran yang dinilai salah pihak — termasuk di sheet, di solver, dan di UI.
  assert.equal(getTournamentPhase(8, 'ranked', false, 5), 'RANKED_BAN', 'langkah 8 pada ranked 5-ban masih fase ban');
  assert.equal(getTournamentPhase(8, 'ranked', false, 3), 'RANKED_PICK', 'langkah 8 pada ranked 3-ban sudah fase pick');
  assert.equal(getDraftTurn(8, 'ranked', false, 5).action, 'ban');
  assert.equal(getDraftTurn(8, 'ranked', false, 3).action, 'pick');

  const position = { ...emptyPosition(), step: 8 };
  const context = { ...makeContext('blue'), format: 'ranked', rankedBanCount: 5 };
  const decision = searchDraft(position, context, FAST);
  assert.notEqual(decision.heroId, null, 'solver harus menemukan aksi legal pada draft ranked 5-ban');
  assert.ok(
    isLegalHero(position, decision.heroId, context),
    'keputusan harus legal untuk giliran sebenarnya (blue ban), bukan giliran urutan 3-ban',
  );
});

test('solver returns a legal decision for the side on turn — blue and red', () => {
  for (const [label, position, expectedSide] of [
    ['B1 blue', blindB1(), 'blue'],
    ['R1 red', afterBlueFirstPick(), 'red'],
  ]) {
    const turn = getDraftTurn(position.step);
    assert.equal(turn.side, expectedSide, `${label}: papan harus berakhir di giliran ${expectedSide}`);
    assert.equal(turn.action, 'pick');

    const context = makeContext(expectedSide);
    const decision = searchDraft(position, context, FAST);

    assert.notEqual(decision.heroId, null, `${label}: solver harus menemukan aksi legal`);
    assert.equal(decision.engineKind, 'search', `${label}: jalur pencarian harus dipakai`);
    assert.ok(decision.completedDepth >= 1, `${label}: minimal satu kedalaman selesai`);
    assert.ok(
      isLegalHero(position, decision.heroId, context),
      `${label}: hero ${decision.heroId} harus legal (belum dipakai/di-ban) untuk ${expectedSide}`,
    );
    assert.ok(
      !position.picks.blue.includes(decision.heroId) && !position.picks.red.includes(decision.heroId),
      `${label}: solver tidak boleh memilih hero yang sudah dipick`,
    );
  }
});

test('searchDraft takes no plan influence when aiPlan is null', () => {
  const position = blindB1();
  const asBlue = searchDraft(position, makeContext('blue'), FAST);
  const asRed = searchDraft(position, makeContext('red'), FAST);
  assert.equal(
    asBlue.heroId,
    asRed.heroId,
    'tanpa plan, aiSide tidak boleh mengubah keputusan (tidak ada plan yang bocor)',
  );

  // Plan sisi yang TIDAK bergiliran juga tidak boleh menyentuh keputusan.
  const opener = rankedCandidates(position, makeContext('blue'))[0].hero.hero_id;
  const redWithPlan = searchDraft(position, makeContext('red', { a: opener, b: null }), FAST);
  assert.equal(redWithPlan.heroId, asBlue.heroId, 'plan sisi lawan tidak boleh memengaruhi keputusan');
});

test('Ultimate Battle: the solver reads the 10-step sequence when the context says so', () => {
  // Game 7 punya urutan 10 langkah tanpa ban; pada langkah 7 urutan turnamen membaca
  // BLUE pick sedangkan Ultimate Battle membaca RED pick. Konteks harus menentukan.
  const context = { ...makeContext('blue'), isUltimateBattle: true };
  let position = emptyPosition();
  while (position.step < 7) {
    const turn = getDraftTurn(position.step, 'tournament', true);
    const candidate = rankedCandidates(position, context)[0];
    if (!candidate) break;
    position = applyDraftAction(position, { ...turn, heroId: candidate.hero.hero_id }, context);
  }
  assert.equal(position.step, 7, 'papan harus berakhir di langkah 7');
  assert.equal(getDraftTurn(7, 'tournament', true).side, 'red');
  assert.equal(getDraftTurn(7, 'tournament').side, 'blue', 'tanpa flag, langkah 7 dibaca sebagai giliran blue');

  const decision = searchDraft(position, { ...context, aiSide: getDraftTurn(7, 'tournament', true).side }, FAST);
  assert.notEqual(decision.heroId, null);
  assert.ok(
    isLegalHero(position, decision.heroId, context),
    'keputusan harus legal untuk giliran Ultimate Battle (red), bukan giliran turnamen (blue)',
  );
});

test('budget ceiling: default stays at 1.500 ms, only the advisor flag opens the extended ceiling', () => {
  assert.equal(MAX_SEARCH_BUDGET_MS, 1500);
  assert.equal(MAX_ADVISOR_BUDGET_MS, 8000);

  // Papan R1 (lawan sudah punya pick): pencarian berjalan penuh. Papan B1 buta
  // TIDAK dipakai di sini karena akar pembuka buta dipotong kedalaman
  // (BLIND_OPENER_MAX_DEPTH) — uji ini menguji plafon anggaran, bukan aturan
  // pembuka.
  const position = afterBlueFirstPick();
  const context = makeContext('blue');
  // Jam palsu: tiap pembacaan jam memajukan 10 ms, jadi batas anggaran bisa diuji
  // tanpa benar-benar menunggu 8 detik.
  const runWithFakeClock = (options) => {
    let ticks = 0;
    const decision = searchDraft(position, context, { ...options, now: () => (ticks += 10) });
    return { decision, ticks };
  };

  const clamped = runWithFakeClock({ maxDepth: 4, width: 8, budgetMs: 8000 });
  const extended = runWithFakeClock({ maxDepth: 4, width: 8, budgetMs: 8000, allowExtendedBudget: true });

  assert.ok(
    clamped.decision.elapsedMs <= MAX_SEARCH_BUDGET_MS + 100,
    `tanpa flag, anggaran harus dijepit ke ${MAX_SEARCH_BUDGET_MS} ms (dapat ${clamped.decision.elapsedMs})`,
  );
  assert.ok(
    extended.decision.elapsedMs > MAX_SEARCH_BUDGET_MS + 100,
    `dengan flag, pencarian boleh melewati ${MAX_SEARCH_BUDGET_MS} ms (dapat ${extended.decision.elapsedMs})`,
  );
  assert.ok(
    extended.decision.elapsedMs <= MAX_ADVISOR_BUDGET_MS + 100,
    `dengan flag, anggaran tetap dijepit ke ${MAX_ADVISOR_BUDGET_MS} ms (dapat ${extended.decision.elapsedMs})`,
  );
  assert.ok(extended.ticks > clamped.ticks, 'pencarian panjang harus benar-benar berjalan lebih lama');
});

test('akar pembuka buta dipotong kedalaman: yang menentukan = rekam jejak first-pick', () => {
  // Di B1 buta subtree balasan lawan hanya spekulasi (komposisi hipotetis),
  // sementara rekam jejak first-pick adalah bukti terukur KPL. Aturan hierarki
  // bukti: bukti terukur tidak boleh dikalahkan sinyal lebih lemah. Maka akar
  // pembuka buta dipotong; begitu lawan sudah punya pick, pencarian penuh lagi.
  const blind = blindB1();
  const blindContext = makeContext('blue');
  const blindDecision = searchDraft(blind, blindContext, {
    maxDepth: 4,
    width: 8,
    budgetMs: 8000,
    allowExtendedBudget: true,
  });

  assert.ok(
    blindDecision.completedDepth <= BLIND_OPENER_MAX_DEPTH,
    `akar pembuka buta tidak boleh lebih dalam dari ${BLIND_OPENER_MAX_DEPTH} ply (dapat ${blindDecision.completedDepth})`,
  );
  assert.notEqual(blindDecision.heroId, null, 'akar pembuka buta tetap harus menghasilkan aksi legal');
  assert.ok(
    isLegalHero(blind, blindDecision.heroId, blindContext),
    'pick B1 harus legal',
  );

  // Hero pembuka yang dipilih harus punya kredibilitas tournament: rekam jejak
  // first-pick atau R1-R2 yang cukup banyak (bukan tebakan tanpa bukti).
  const openerInfo = kplPresenceOf(blindDecision.heroId, synergy.b1_openers);
  assert.ok(openerInfo, 'pick pembuka harus punya catatan tournament');
  assert.ok(
    (openerInfo.b1 ?? 0) >= 90 || (openerInfo.r1r2 ?? 0) >= 180,
    `pick pembuka harus punya kredibilitas first-pick (b1=${openerInfo?.b1}, r1r2=${openerInfo?.r1r2})`,
  );

  // Begitu lawan sudah punya pick, pencarian kembali kedalaman penuh.
  const contested = afterBlueFirstPick();
  const contestedDecision = searchDraft(contested, makeContext('red'), {
    maxDepth: 4,
    width: 8,
    budgetMs: 8000,
    allowExtendedBudget: true,
  });
  assert.ok(
    contestedDecision.completedDepth > BLIND_OPENER_MAX_DEPTH,
    `di slot dengan lawan terisi, pencarian harus penuh (dapat ${contestedDecision.completedDepth} ply)`,
  );
});

test('worker protocol accepts side + options for the advisor path and forwards no player plan', async () => {
  const sent = [];
  class BrowserWorkerAdapter {
    constructor() {
      this.worker = new NodeWorker(new URL('./worker-harness.mjs', import.meta.url), {
        execArgv: ['--import', new URL('./register.mjs', import.meta.url).href],
      });
      this.worker.on('message', (data) => this.onmessage?.({ data }));
      this.worker.on('error', (error) => this.onerror?.(error));
    }
    postMessage(data) { sent.push(data); this.worker.postMessage(data); }
    terminate() { return this.worker.terminate(); }
  }
  globalThis.Worker = BrowserWorkerAdapter;
  // Sisi default konstruktor sengaja 'red' (perilaku lawan AI); jalur advisor harus
  // menang karena `side` dikirim per permintaan.
  const client = new OpponentClient(dataset, 'red');
  const position = afterBlueFirstPick();
  try {
    const decision = await client.decide(
      position,
      {
        fearless: { blue: [], red: [] },
        aiPlan: { a: null, b: null },
        format: 'tournament',
        side: 'blue',
        isUltimateBattle: false,
        options: { maxDepth: 2, width: 6, budgetMs: 500, allowExtendedBudget: true },
      },
      { sessionId: 'advisor-side-fixture', revision: 1 },
      new AbortController().signal,
    );

    assert.notEqual(decision.heroId, null);
    assert.equal(decision.engineKind, 'search');
    assert.ok(
      isLegalHero(position, decision.heroId, { heroes, onlyGlobal: true, fearless: { blue: [], red: [] } }),
      'keputusan worker harus legal untuk papan yang dikirim',
    );

    const request = sent.find((message) => message.type === 'decide');
    assert.ok(request, 'worker harus menerima pesan decide');
    assert.equal(request.side, 'blue');
    assert.equal(request.isUltimateBattle, false);
    assert.deepEqual(request.options, { maxDepth: 2, width: 6, budgetMs: 500, allowExtendedBudget: true });
    assert.deepEqual(request.aiPlan, { a: null, b: null });
    assert.equal('playerPlan' in request, false);
  } finally {
    client.cancel();
    delete globalThis.Worker;
  }
});
