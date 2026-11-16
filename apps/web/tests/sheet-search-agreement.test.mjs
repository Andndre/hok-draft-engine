/**
 * @file sheet-search-agreement.test.mjs
 * @description Regresi untuk metrik agreement antara lembar rekomendasi
 * (`runTournamentInference` -> `recommendations[0]`) dan pencarian minimax
 * (`searchDraft` -> `heroId`).
 *
 * Lantai (floor) di bawah adalah ANGKA TERUKUR SAAT INI, bukan target. Tujuan test
 * ini adalah mengunci perilaku hari ini: perbaikan yang menaikkan agreement tetap
 * lolos (>=), sedangkan regresi yang menurunkannya gagal. JANGAN menurunkan lantai
 * untuk membuat test hijau, dan JANGAN menaikkannya untuk memaksa perbaikan.
 *
 * Jalankan:
 *   cd apps/web
 *   node --import ./tests/register.mjs --test tests/sheet-search-agreement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measureSheetSearchAgreement, PICK_STEPS } from './sheetSearchAgreement.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);

/**
 * Agreement terukur pada 16 Nov 2026: 33 dari 41 posisi = 80,49%.
 *
 * SEBELUM advisory ranking diperkenalkan angkanya hanya 8 dari 41 (19,51%): lembar
 * menilai hero per-individu (bonus planned opener +1,45, radar taktis, sinergi duet)
 * sementara solver menilai nilai PAPAN setelah pohon respon. Sekarang kandidat
 * lembar diurutkan ulang dengan evaluator posisi milik solver (src/engine/
 * advisorRanking.ts), jadi keduanya memakai satu sumber kebenaran penilaian.
 *
 * Kenaikan 26/41 → 33/41 (63,41% → 80,49%) datang dari dua aturan opener yang
 * keduanya memakai BUKTI TERUKUR:
 *  1. Term opener (`computeOpenerPriorityScore`, rekam jejak first-pick KPL)
 *     masuk ke evaluator posisi solver untuk hero di slot pembuka.
 *  2. Akar PEMBUKA BUTA dipotong kedalaman (`BLIND_OPENER_MAX_DEPTH`): saat
 *     kedua sisi belum punya pick, lineup yang dinilai subtree balasan lawan
 *     hanya spekulasi, sementara rekam jejak first-pick adalah bukti terukur.
 *     Hierarki bukti: bukti terukur tidak boleh dikalahkan sinyal lebih lemah.
 *     Akibatnya B1 buta naik dari 0/5 menjadi 5/5 (=100%).
 *
 * Lantai dinaikkan ke angka terukur BARU — perbaikan nyata dikunci agar tidak
 * bisa hilang diam-diam. Sisa divergensi masih besar di R4 (1/4).
 */
const MEASURED_SHEET_SEARCH_AGREEMENT = 33 / 41;
const MEASURED_SAMPLE_SIZE = 41;

test('sheet top-1 vs minimax top-1 agreement stays at or above the measured floor', () => {
  const summary = measureSheetSearchAgreement({ heroes, synergy });

  // Sampel harus mencakup seluruh langkah pick turnamen dan B1 buta (>= 40 posisi).
  assert.ok(
    summary.sample_size >= 40,
    `sample too small: ${summary.sample_size} (need >= 40)`
  );
  assert.equal(summary.sample_size, MEASURED_SAMPLE_SIZE, 'sample composition changed; re-measure before adjusting the floor');

  const sampledSteps = new Set(summary.by_step.map((b) => b.step));
  for (const step of PICK_STEPS) {
    assert.ok(sampledSteps.has(step), `pick step ${step} is not sampled`);
  }

  // Setiap baris harus punya top-1 sheet dan top-1 search.
  assert.ok(summary.positions.every((row) => row.sheet_hero_id !== null), 'sheet produced no top-1 for some position');
  assert.ok(summary.positions.every((row) => row.search_hero_id !== null), 'search produced no top-1 for some position');

  assert.ok(
    summary.sheet_search_agreement_rate >= MEASURED_SHEET_SEARCH_AGREEMENT,
    `agreement regressed: ${(summary.sheet_search_agreement_rate * 100).toFixed(2)}% < measured floor ` +
      `${(MEASURED_SHEET_SEARCH_AGREEMENT * 100).toFixed(2)}% (${summary.agreements}/${summary.sample_size})`
  );
});
