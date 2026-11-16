import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRAFT_SEQUENCE,
  emptyPosition,
  getDraftTurn,
  applyDraftAction,
  isLegalHero,
  analyzeLaneOccupancy,
  IMMOBILE_OPENERS,
  evaluateTeamCompositionIntegrity,
  computeKplPairAdjustment,
  computeSeriesFearlessLocks,
  teamOnSide,
  FLOWBORN_HERO_IDS,
  isFlowborn,
  getDoublePickWindow,
} from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft, evaluatePosition } from '../src/engine/draftSearch.ts';
import { evaluateTacticalScores, evaluateEnemyCounterExposure, reviewedHoKStatsBonuses, runTournamentInference, kplPresenceOf, competitiveStrength, counterEvidenceFor, measuredMatchupBetween, MEASURED_MIN_SAMPLE } from '../src/engine/tournamentInference.ts';
import { matchesDecisionTag, OpponentClient } from '../src/engine/opponentClient.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const context = () => ({ heroes, synergy, onlyGlobal: true, fearless: { blue: [], red: [] }, aiSide: 'red', aiPlan: { a: null, b: null } });
function advance(position, ctx, count) {
  for (let i = 0; i < count; i++) {
    const heroId = rankedCandidates(position, ctx)[0]?.hero.hero_id;
    assert.ok(heroId, 'legal candidate should exist');
    position = applyDraftAction(position, { ...getDraftTurn(position.step), heroId }, ctx);
  }
  return position;
}
test('five Fearless games complete with legal Global rosters and no repeated team picks', () => {
  const ctx = context();
  for (let game = 0; game < 5; game++) {
    const position = advance(emptyPosition(), ctx, DRAFT_SEQUENCE.length);
    assert.equal(position.step, 18);
    assert.equal(position.picks.blue.length + position.picks.red.length, 10);
    assert.equal(position.bans.blue.length + position.bans.red.length, 8);
    assert.equal(new Set([...position.picks.blue, ...position.picks.red, ...position.bans.blue, ...position.bans.red]).size, 18);
    for (const side of ['blue', 'red']) {
      assert.equal(analyzeLaneOccupancy(heroes.filter(h => position.picks[side].includes(h.hero_id))).occupiedLanes.size, 5);
      assert.ok(position.picks[side].every(id => !ctx.fearless[side].includes(id)));
      ctx.fearless[side].push(...position.picks[side]);
    }
    const extra = applyDraftAction(position, { heroId: heroes[0].hero_id, side: 'blue', action: 'pick' }, ctx);
    assert.equal(extra, position);
  }
});
test('same validator rejects duplicates, wrong turns, CN heroes, and Ata alias', () => {
  const ctx = context(), position = emptyPosition();
  assert.equal(isLegalHero(position, 194, ctx), false);
  assert.equal(isLegalHero(position, 511, ctx), false);
  const id = rankedCandidates(position, ctx)[0].hero.hero_id;
  assert.equal(applyDraftAction(position, { heroId: id, side: 'red', action: 'ban' }, ctx), position);
  const next = applyDraftAction(position, { heroId: id, side: 'blue', action: 'ban' }, ctx);
  assert.equal(isLegalHero(next, id, ctx), false);
  ctx.fearless.blue.push(556);
  assert.equal(isLegalHero(position, 556, ctx), true, 'Fearless only restricts picks');
  assert.equal(isLegalHero({ ...position, step: 4 }, 556, ctx), false);
});
test('flex assignment reassigns an earlier hero to preserve all five lanes', () => {
  const base = heroes[0];
  const selected = [
    { ...base, primary_lane: 'Clash', lanes: ['Clash', 'Jungle'] },
    { ...base, primary_lane: 'Clash', lanes: ['Clash'] },
    ...['Mid', 'Farm', 'Roam'].map(lane => ({ ...base, primary_lane: lane, lanes: [lane] })),
  ];
  assert.equal(analyzeLaneOccupancy(selected).occupiedLanes.size, 5);
});
test('Fearless ban planning keeps own locked openers out and never wastes a recommendation on an enemy-locked hero', () => {
  const result = runTournamentInference([], [], [], [156], false, true, heroes, 0, 156, null, true, synergy, [556]);
  assert.ok(result.phaseStrategy.candidateOpeners.every(h => h.hero_id !== 156));
  assert.notEqual(result.phaseStrategy.plannedOpener?.hero_id, 156);
  assert.ok(result.recommendations.every(r => r.hero.hero_id !== 556));
  assert.ok(result.recommendations.some(r => r.hero.hero_id === 156), 'Own Fearless lock does not make a legal ban unavailable');
});
test('Liang direction, Ata mapping, and competitive opener restrictions remain intact', () => {
  const liang = heroes.find(h => h.name === 'Liang');
  assert.ok(liang.counters.some(c => c.target_id === 131), 'Liang counters Li Bai');
  assert.ok(liang.countered_by.some(c => c.counter_id === 182), 'Gan & Mo threatens Liang');
  assert.ok(heroes.some(h => h.hero_id === 556));
  assert.equal(heroes.some(h => h.hero_id === 511), false);
  for (const step of [0, 1, 2, 3, 4]) {
    const result = runTournamentInference([], [], [], [], step === 4, true, heroes, step, null, null, true, synergy);
    assert.ok(result.recommendations.every(r => !IMMOBILE_OPENERS.has(r.hero.hero_id)));
  }
});
test('default Phase 1 ban avoids blind Liang/Shouyue tunnel-vision and penalizes candidates countered by 2-3 enemies', () => {
  const defaultBan = runTournamentInference([], [], [], [], false, true, heroes, 0, null, null, true, synergy);
  assert.notEqual(defaultBan.phaseStrategy.plannedOpener?.hero_id, 156, 'Liang is not forced as blind #1 default opener');
  assert.notEqual(defaultBan.recommendations[0]?.hero.hero_id, 196, 'Shouyue is not forced as #1 default ban');

  const liang = heroes.find(h => h.hero_id === 156);
  const liangCounters = [182, 127, 175, 196].map(id => heroes.find(h => h.hero_id === id)).filter(Boolean);
  const exp3 = evaluateEnemyCounterExposure(liang, liangCounters.slice(0, 3), synergy.b1_openers);
  assert.equal(exp3.counterCount, 3);
  assert.equal(exp3.synergyMultiplier, 0.0, 'KPL synergy is zeroed out when countered by 3 enemy heroes');
  assert.ok(exp3.exposurePenalty >= 2.6, 'compounding penalty applied for 3 enemy counters');

  const uncounteredPick = runTournamentInference([171], [105], [], [], true, true, heroes, 7, null, null, true, synergy);
  const counteredPick = runTournamentInference([171], [182, 127, 175], [], [], true, true, heroes, 7, null, null, true, synergy);
  const liangSafeScore = uncounteredPick.recommendations.find(r => r.hero.hero_id === 156)?.choiceScore ?? 0;
  const liangCounteredScore = counteredPick.recommendations.find(r => r.hero.hero_id === 156)?.choiceScore ?? 0;
  assert.ok(liangSafeScore - liangCounteredScore >= 2.5, 'hero countered by 3 enemies drops sharply despite team synergy');

  const r1AfterAoyin = runTournamentInference([], [519], [521, 156, 517, 126], [], true, false, heroes, 5, null, null, true, synergy);
  const top10Ids = r1AfterAoyin.recommendations.slice(0, 10).map(r => r.hero.hero_id);
  assert.equal(top10Ids.includes(507), false, 'Pub-only Li Xin (0 KPL matches) is never recommended as R1 tournament opener');
});
test('Phase 1 ban never targets a hero the planned opener already counters (Ao\'yin cancels Marco Polo ult)', () => {
  const aoyin = heroes.find(h => h.hero_id === 519);
  const marco = heroes.find(h => h.hero_id === 132);
  assert.ok(aoyin.counters.some(c => c.target_id === marco.hero_id), 'Ao\'yin knockback counter atas Marco Polo berasal dari kurasi data');
  assert.ok(marco.countered_by.some(c => c.counter_id === aoyin.hero_id && c.severity === 'hard'), 'relasi ter-invert ke countered_by Marco Polo');

  // Plan opener dikunci ke Ao'yin supaya guard teruji secara deterministik,
  // bukan bergantung pada hero mana yang kebetulan jadi opener default.
  const ban = runTournamentInference([], [], [], [], false, true, heroes, 0, 519, null, true, synergy);
  const opener = heroes.find(h => h.hero_id === ban.phaseStrategy.plannedOpener?.hero_id);
  assert.equal(opener?.hero_id, 519, 'opener yang diuji adalah Ao\'yin');
  const beatenIds = new Set(opener.counters.map(c => c.target_id));
  const wasted = ban.recommendations.slice(0, 5).filter(r => beatenIds.has(r.hero.hero_id));
  assert.deepEqual(wasted.map(r => r.hero.name), [], 'slot ban tidak boleh dihabiskan untuk hero yang sudah di-counter opener sendiri');
  const marcoRec = ban.recommendations.find(r => r.hero.hero_id === marco.hero_id);
  assert.ok(marcoRec.choiceScore < 0, 'Marco Polo turun tajam saat opener kita Ao\'yin');
  assert.match(marcoRec.proComboTag ?? '', /sudah meng-counter/);
});
test('KPL opener priority reads recency-weighted presence, not all-time counts', () => {
  // Artifact KPL membawa dua versi hitungan. Mesin harus memakai yang berbobot 12 bulan,
  // karena hitungan all-time membuat hero era lama (Dun, Kaizer, Marco Polo) tetap dinilai
  // sekuat hero meta sekarang. Lihat kplPresenceOf(). Dataset lama tanpa field berbobot
  // tetap berjalan identik lewat fallback.
  const stat = (b1, r1, p1, opts = {}) => ({
    hero_id: opts.id ?? 0,
    b1_picks: b1, r1_r2_picks: r1, p1_bans: p1, b1_win_rate: opts.wr ?? 0.5,
    ...(opts.weighted ? {
      weighted_b1_picks: opts.wb1 ?? b1,
      weighted_r1_r2_picks: opts.wr1 ?? r1,
      weighted_p1_bans: opts.wp1 ?? p1,
      weighted_b1_win_rate: opts.wwr ?? opts.wr ?? 0.5,
    } : {}),
  });

  // Medan sintetis: satu hero dominan sekarang, satu hero jaya di masa lalu.
  const field = {
    1: stat(400, 400, 800, { id: 1, weighted: true, wb1: 400, wr1: 400, wp1: 800, wwr: 0.5 }),
    // hero 2: 300 pick all-time tapi hanya 30 di 12 bulan terakhir (era-faded)
    2: stat(300, 300, 600, { id: 2, weighted: true, wb1: 30, wr1: 30, wp1: 60, wwr: 0.44 }),
    3: stat(100, 100, 200, { id: 3, weighted: true, wb1: 100, wr1: 100, wp1: 200, wwr: 0.5 }),
  };
  const faded = kplPresenceOf(2, field);
  const current = kplPresenceOf(1, field);
  assert.ok(faded && current, 'presence tersedia untuk kedua hero');
  assert.ok(faded.shareRatio < current.shareRatio * 0.25, 'hero era-faded jatuh jauh di bawah hero meta sekarang');
  assert.ok(faded.b1 < 300, 'hitungan all-time hero faded diturunkan ke padanan meta sekarang');
  assert.ok(faded.b1WinRate < faded.fieldB1WinRate, 'winrate B1 di bawah baseline medan untuk hero yang kalah sebagai first pick');

  // Tanpa field berbobot: perilaku identik dengan versi lama (tidak ada regresi dataset lama).
  const legacy = { 7: stat(120, 90, 40, { id: 7 }) };
  const legacyPresence = kplPresenceOf(7, legacy);
  assert.equal(legacyPresence.shareRatio, 1, 'hero tunggal mengisi seluruh medan');
  assert.equal(legacyPresence.b1, 120, 'tanpa field berbobot hitungan all-time dipakai apa adanya');
  assert.equal(legacyPresence.b1WinRate, null, 'field berbobot wajib ada sebelum winrate B1 dipakai');
});

test('an all-time-only ban record cannot resurrect a hero who left the draft meta', () => {
  // Marco Polo: 167 B1 all-time tapi 2,6 di 12 bulan terakhir. Ambang all-time `b1_picks >= 160`
  // dulu menaruhnya di 10 besar ban fase 1 sisi Red.
  const redBan = runTournamentInference([], [], [], [], false, false, heroes, 0, null, null, true, synergy);
  const top10 = redBan.recommendations.slice(0, 10).map(r => r.hero.name);
  assert.equal(top10.includes('Marco Polo'), false, 'Marco Polo tidak lagi muncul di 10 besar ban fase 1 Red');
});

test('current-meta openers outrank era-faded ones at B1', () => {
  const b1 = runTournamentInference([], [], [], [], true, true, heroes, 4, null, null, true, synergy);
  const rankOf = (name) => b1.recommendations.findIndex(r => r.hero.name === name) + 1;
  const currentMeta = ['Ao\'yin', 'Dunshan'];
  const eraFaded = ['Dun', 'Kaizer'];
  const worstCurrent = Math.max(...currentMeta.map(rankOf));
  const bestFaded = Math.min(...eraFaded.map(rankOf));
  assert.ok(worstCurrent < bestFaded, `opener meta sekarang (${currentMeta.join(', ')}) harus di atas hero era-faded (${eraFaded.join(', ')})`);
  // Tetap bisa direkomendasikan: perbaikan ini mengoreksi bobot, bukan memblokir hero.
  assert.ok(rankOf('Dun') <= 30 && rankOf('Kaizer') <= 30, 'Dun/Kaizer tetap muncul di papan rekomendasi sesuai konteks');
});
test('counter relations carry explicit provenance: curated vs Kurohiko article', () => {
  const aoyin = heroes.find(h => h.hero_id === 519);
  const marco = heroes.find(h => h.hero_id === 132);
  const arli = heroes.find(h => h.hero_id === 199);

  const curated = aoyin.counters.find(c => c.target_id === marco.hero_id);
  assert.ok(curated, 'relasi Ao\'yin -> Marco Polo ada di dataset');
  assert.equal(curated.source, 'curation', 'relasi kurasi manual tidak boleh diklaim berasal dari artikel Kurohiko');
  assert.ok(curated.reviewed_at, 'kurasi manual mencantumkan tanggal review');

  const scraped = marco.countered_by.find(c => c.counter_id === arli.hero_id);
  assert.ok(scraped, 'relasi Arli -> Marco Polo dari artikel Kurohiko ada');
  assert.equal(scraped.source, 'kurohiko', 'relasi artikel Kurohiko harus ditandai kurohiko');

  // Tidak boleh ada relasi tanpa sumber.
  for (const hero of heroes) {
    for (const entry of hero.counters || []) {
      assert.ok(entry.source, `${hero.name} -> ${entry.target_name} tanpa sumber`);
    }
    for (const entry of hero.countered_by || []) {
      assert.ok(entry.source, `${hero.name} <- ${entry.counter_name} tanpa sumber`);
    }
  }
});

test('no hero carries fabricated ranked rates (placeholder 3.5% pick / 1.0% ban)', () => {
  // Sinkronisasi lama memberi 0,035 pick + 0,010 ban pada hero tanpa data ranked.
  // Angka itu membuat hero baru tampak lebihdma dalam dari kenyataan, jadi harus hilang.
  for (const hero of heroes) {
    const placeholder = Math.abs((hero.pick_rate ?? 0) - 0.035) < 1e-9 && Math.abs((hero.ban_rate ?? 0) - 0.01) < 1e-9;
    assert.equal(placeholder, false, `${hero.name} masih memakai placeholder pick/ban`);
  }
  // Setiap hero Global yang punya data harus menandai sumber win rate-nya.
  const released = heroes.filter(h => h.is_global_released === true);
  const labelled = released.filter(h => ['ranked', 'kpl', 'legacy', 'none', 'unknown'].includes(h.win_rate_source));
  assert.equal(labelled.length, released.length, 'setiap hero Global harus punya win_rate_source');
});

test('popularity band is NOT a strength signal; strength comes from KPL evidence', () => {
  // Band S/A/B/C dari HoK Camp = seberapa sering hero dipilih/dibanned, bukan kekuatan.
  // Angela paling dipilih (band S) tapi winrate KPL-nya di bawah rata-rata; Guan Yu
  // band C tapi thousands pick KPL dengan winrate di atas rata-rata.
  const angela = heroes.find(h => h.hero_id === 142);
  const guanYu = heroes.find(h => h.hero_id === 140);
  assert.equal(angela.popularity_band, 'S', 'Angela tetap terdokumentasi sebagai band S');
  assert.notEqual(guanYu.popularity_band, 'S', 'Guan Yu bukan band S');
  assert.ok(
    competitiveStrength(guanYu) > competitiveStrength(angela),
    'band popularitas tidak boleh menentukan kekuatan',
  );
  assert.equal(heroes.some(h => 'tier' in h), false, 'field "tier" tidak lagi dipakai di dataset');

  // Hero dengan band sama tapi bukti KPL berbeda harus punya kekuatan berbeda.
  const base = {
    hero_id: 9001,
    name: 'Fixture A',
    popularity_band: 'B',
    win_rate: 0.5,
    win_rate_source: 'ranked',
    kpl_matches: 400,
    kpl_weighted_matches: 400,
    kpl_weighted_win_rate: 0.56,
  };
  const weaker = { ...base, hero_id: 9002, name: 'Fixture B', kpl_weighted_win_rate: 0.44 };
  assert.ok(
    competitiveStrength(base) > competitiveStrength(weaker),
    'bukti KPL (bukan band) yang membedakan kekuatan',
  );
  const bandOnly = { ...base, hero_id: 9003, name: 'Fixture C', popularity_band: 'S', kpl_weighted_win_rate: 0.44 };
  assert.equal(
    competitiveStrength(weaker),
    competitiveStrength(bandOnly),
    'mengubah band popularitas tidak boleh mengubah kekuatan',
  );
});
test('minimax follows consecutive Red picks and completes bounded iterative deepening', () => {
  const ctx = context(), position = advance(emptyPosition(), ctx, 5);
  const result = searchDraft(position, ctx, { maxDepth: 3, width: 2 });
  assert.equal(result.completedDepth, 3);
  assert.deepEqual(result.principalVariation.map(a => a.side), ['red', 'red', 'blue']);
  let replay = position;
  for (const action of result.principalVariation) {
    const next = applyDraftAction(replay, action, ctx); assert.notEqual(next, replay); replay = next;
  }
  assert.equal(evaluatePosition(position, ctx, 'blue'), -evaluatePosition(position, ctx, 'red'));
});
test('deadline returns a legal deterministic baseline and never mutates the input', () => {
  const ctx = context(), position = emptyPosition(), before = structuredClone(position);
  const decision = searchDraft(position, ctx, { budgetMs: 0 });
  assert.equal(decision.completedDepth, 0);
  assert.equal(decision.engineKind, 'deterministic');
  assert.ok(isLegalHero(position, decision.heroId, ctx));
  assert.deepEqual(position, before);
});
test('interrupted deepening retains the fully completed principal variation', () => {
  let ticks = 0;
  const ctx = context(), position = advance(emptyPosition(), ctx, 5);
  const result = searchDraft(position, ctx, { width: 4, maxDepth: 4, budgetMs: 120, now: () => ticks++ });
  assert.ok(result.completedDepth >= 1 && result.completedDepth < 4);
  assert.equal(result.principalVariation.length, result.completedDepth);
  assert.equal(result.heroId, result.principalVariation[0].heroId);
});
test('approved tactical tags improve role-only assessment without requiring every hero to have a profile', () => {
  const hero = heroes.find(h => h.primary_role === 'Mage');
  const baseline = evaluateTacticalScores([hero], []);
  const reviewed = { ...hero, tactical_profile: { tags: { frontline: true, suppress: true }, source_hash: 'fixture', model: 'fixture', reviewed_by: 'Fixture reviewer' } };
  const enriched = evaluateTacticalScores([reviewed], []);
  assert.ok(enriched.frontline_durability > baseline.frontline_durability);
  assert.ok(enriched.cc_chain_lockdown > baseline.cc_chain_lockdown);
});
test('HoKStats matchup and trait bonuses require Global release and review, and obey their caps', () => {
  const global = heroes.filter(h => h.is_global_released === true);
  const candidateBase = global.find(h => h.primary_role === 'Mage');
  const enemies = global.filter(h => h.hero_id !== candidateBase.hero_id).slice(0, 6);
  const approvedSource = { source: 'HoKStats', url: 'https://hokstats.gg/heroes/test/', fetched_at: '2026-11-09', patch_version: null, review_status: 'approved' };
  const pendingSource = { ...approvedSource, review_status: 'pending' };
  const allTags = { frontline: true, engage: true, peel: true, ally_shield: true, ally_heal: true, ally_move_speed_buff: true, ally_attack_speed_buff: true, ally_damage_buff: true, ally_cleanse: true, ally_cc_immunity: true };
  const matchups = enemies.map(enemy => ({ relation: 'strong_against', hero_id: enemy.hero_id, hero_name: enemy.name, evidence: 'editorial', source: approvedSource }));
  const candidate = { ...candidateBase, tactical_profile: { tags: allTags }, hokstats_guide: { matchups } };
  const bonuses = reviewedHoKStatsBonuses(candidate, [], enemies);
  assert.equal(bonuses.matchupBonus, 0.45);
  assert.equal(bonuses.traitBonus, 0.45);
  assert.equal(bonuses.totalBonus, 0.45, 'combined secondary signal stays below a direct +0.55 counter');
  assert.deepEqual(reviewedHoKStatsBonuses({ ...candidate, is_global_released: false }, [], enemies), { matchupBonus: 0, traitBonus: 0, totalBonus: 0 });
  const pending = { ...candidate, hokstats_guide: { matchups: matchups.map(m => ({ ...m, source: pendingSource })) } };
  assert.equal(reviewedHoKStatsBonuses(pending, [], enemies).matchupBonus, 0);
  const reverse = { ...candidate, hokstats_guide: { matchups: [] } };
  const counteredBy = enemies.map(enemy => ({ ...enemy, hokstats_guide: { matchups: [{ relation: 'countered_by', hero_id: candidate.hero_id, hero_name: candidate.name, evidence: 'editorial', source: approvedSource }] } }));
  assert.equal(reviewedHoKStatsBonuses(reverse, [], counteredBy).matchupBonus, 0.45);
  assert.deepEqual(reviewedHoKStatsBonuses({ ...candidateBase, hokstats_guide: { pros: ['Extremely durable tank'], cons: ['Can be kited'] } }, [], enemies), { matchupBonus: 0, traitBonus: 0, totalBonus: 0 });
  assert.ok(evaluateTacticalScores([candidate], []).team_utility >= 0 && evaluateTacticalScores([candidate], []).team_utility <= 1);
});
test('stale worker responses cannot match another revision or session', () => {
  const tag = { sessionId: 'session-a', revision: 7 };
  assert.equal(matchesDecisionTag(tag, { ...tag, revision: 8 }), false);
  assert.equal(matchesDecisionTag(tag, { ...tag, sessionId: 'session-b' }), false);
  assert.equal(matchesDecisionTag(tag, { ...tag }), true);
});
test('worker failure uses local fallback and cancellation rejects pending requests', async () => {
  const dataset = { heroes, synergy }, ctx = context();
  const client = new OpponentClient(dataset, 'red');
  const result = await client.decide(emptyPosition(), ctx, { sessionId: 'fixture', revision: 0 }, new AbortController().signal);
  assert.equal(result.engineKind, 'deterministic'); // Node has no browser Worker.
  assert.ok(result.fallbackReason);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.decide(emptyPosition(), ctx, { sessionId: 'fixture', revision: 1 }, abort.signal), { name: 'AbortError' });
  client.cancel();
});

test('runTournamentInference flex reassignment in Pick Phase and enemy flex openness in BAN_PHASE_2 work consistently', () => {
  const template = heroes.find(h => h.is_global_released === true && h.hero_id !== 511);
  const makeHero = (hero_id, name, lane, lanes, role) => ({
    ...template,
    hero_id,
    name,
    primary_lane: lane,
    lanes,
    primary_role: role,
    tier: 'A',
    win_rate: 0.51,
    pick_rate: 0.08,
    ban_rate: 0.02,
    is_global_released: true,
    counters: [],
    countered_by: [],
    kpl_matchup: undefined,
    hokstats_guide: undefined,
    tactical_profile: undefined,
  });

  const flexClashJungle = makeHero(8101, 'FlexCJ', 'Clash', ['Clash', 'Jungle'], 'Fighter');
  const pureMid = makeHero(8102, 'OurMid', 'Mid', ['Mid'], 'Mage');
  const pureFarm = makeHero(8103, 'OurFarm', 'Farm', ['Farm'], 'Marksman');
  const pureRoam = makeHero(8104, 'OurRoam', 'Roam', ['Roam'], 'Support');
  const candPureClash = makeHero(8105, 'CandClash', 'Clash', ['Clash'], 'Fighter');
  const candDupMid = makeHero(8106, 'CandMidDup', 'Mid', ['Mid'], 'Mage');

  const enemyFlexCJ = makeHero(8201, 'EnemyFlexCJ', 'Clash', ['Clash', 'Jungle'], 'Fighter');
  const enemyPureMid = makeHero(8202, 'EnemyMid', 'Mid', ['Mid'], 'Mage');
  const enemyPureFarm = makeHero(8203, 'EnemyFarm', 'Farm', ['Farm'], 'Marksman');
  const fillerRoam = makeHero(8204, 'FillerRoam', 'Roam', ['Roam'], 'Support');
  const fillerJung = makeHero(8205, 'FillerJung', 'Jungle', ['Jungle'], 'Assassin');

  const syntheticHeroes = [
    flexClashJungle,
    pureMid,
    pureFarm,
    pureRoam,
    candPureClash,
    candDupMid,
    enemyFlexCJ,
    enemyPureMid,
    enemyPureFarm,
    fillerRoam,
    fillerJung,
  ];
  const emptySynergy = { pairs: {}, b1_openers: {}, hero_lane_rates: {} };

  // Pick Phase step 16 (Blue has FlexCJ + Mid + Farm + Roam; FlexCJ slides to Jungle when CandClash enters)
  const pickInference = runTournamentInference(
    [flexClashJungle.hero_id, pureMid.hero_id, pureFarm.hero_id, pureRoam.hero_id],
    [enemyFlexCJ.hero_id, enemyPureMid.hero_id, enemyPureFarm.hero_id, fillerRoam.hero_id],
    [],
    [],
    true,
    true,
    syntheticHeroes,
    16,
    null,
    null,
    true,
    emptySynergy
  );
  const clashRec = pickInference.recommendations.find(r => r.hero.hero_id === candPureClash.hero_id);
  const dupMidRec = pickInference.recommendations.find(r => r.hero.hero_id === candDupMid.hero_id);
  assert.ok(clashRec && dupMidRec, 'Both candidates should be scored');
  assert.ok(!clashRec.laneTag?.includes('Sudah'), 'Flex hero slides to Jungle so Clash candidate is not penalized as duplicate');
  assert.ok(dupMidRec.laneTag?.includes('Sudah Penuh'), 'True duplicate Mid without flex partner is flagged');
  assert.ok(clashRec.choiceScore > dupMidRec.choiceScore, 'Flex-compatible Clash completion outscores duplicate Mid');

  // BAN_PHASE_2 step 10 (Blue Ban; Red picked EnemyFlexCJ + EnemyMid + EnemyFarm, leaving Jungle/Roam open AND Clash open via flex!)
  const banPhase2Inference = runTournamentInference(
    [pureMid.hero_id, pureFarm.hero_id],
    [enemyFlexCJ.hero_id, enemyPureMid.hero_id, enemyPureFarm.hero_id],
    [],
    [],
    false,
    true,
    syntheticHeroes,
    10,
    null,
    null,
    true,
    emptySynergy
  );
  const banClash = banPhase2Inference.recommendations.find(r => r.hero.hero_id === candPureClash.hero_id);
  const banClosedMid = banPhase2Inference.recommendations.find(r => r.hero.hero_id === candDupMid.hero_id);
  assert.ok(banClash && banClosedMid);
  assert.ok(
    banClash.choiceScore > banClosedMid.choiceScore,
    'BAN_PHASE_2 values denying Clash pick because EnemyFlexCJ can flex to Jungle, unlike truly closed Mid'
  );
});

test('AI never forces a Roam Support (Da Qiao) into Mid to draft a second Roam Support while preserving valid flexes', () => {
  const byName = (name) => {
    const hero = heroes.find(h => h.name === name);
    assert.ok(hero, `Missing Global hero ${name}`);
    return hero;
  };
  const kaizer = byName('Kaizer');
  const marco = byName('Marco Polo');
  const luBu = byName('Lu Bu');
  const daQiao = byName('Da Qiao');
  const sunBin = byName('Sun Bin');
  const wang = byName('Wang Zhaojun');
  const liang = byName('Liang');
  const lapu = byName('Lapulapu');
  const biron = byName('Biron');
  const yixing = byName('Yixing');
  const fang = byName('Fang');

  const kplRates = synergy?.hero_lane_rates;
  const brokenIntegrity = evaluateTeamCompositionIntegrity([kaizer, marco, luBu, daQiao, sunBin], kplRates);
  assert.equal(brokenIntegrity.displacedSupports.map(h => h.hero_id).includes(daQiao.hero_id), true);
  assert.equal(brokenIntegrity.duplicateRoamSupports, 1);
  assert.equal(brokenIntegrity.isFullCompWithoutMagicDamage, true);

  const validFlexIntegrity = evaluateTeamCompositionIntegrity([kaizer, marco, luBu, liang, wang], kplRates);
  assert.equal(validFlexIntegrity.displacedSupports.length, 0);
  assert.equal(validFlexIntegrity.duplicateRoamSupports, 0);
  assert.equal(validFlexIntegrity.isFullCompWithoutMagicDamage, false);
  assert.equal(validFlexIntegrity.laneState.assignments.get(kaizer.hero_id), 'Jungle');
  assert.equal(validFlexIntegrity.laneState.assignments.get(liang.hero_id), 'Roam');

  // Negative KPL synergy guard (Da Qiao + Sun Bin: 26.7% WR across 15 games)
  const negSyn = computeKplPairAdjustment(synergy?.pairs?.['118_191']);
  assert.ok(negSyn < 0, `Expected negative anti-synergy adjustment for Da Qiao + Sun Bin, got ${negSyn}`);

  const redPicks = [lapu.hero_id, biron.hero_id, yixing.hero_id, fang.hero_id];
  const blueStep15 = [kaizer.hero_id, marco.hero_id, luBu.hero_id];
  const aiCtx = {
    ...context(),
    aiSide: 'blue',
  };

  // Step 15 (B4) search should complete with a Roam + genuine Mid Mage, never Zhuangzi/Sun Bin + Da Qiao Mid
  const dec15 = searchDraft(
    { step: 15, picks: { blue: blueStep15, red: redPicks }, bans: { blue: [], red: [] } },
    aiCtx,
    { budgetMs: 1200 }
  );
  const b4Hero = heroes.find(h => h.hero_id === dec15.heroId);
  assert.ok(b4Hero && (b4Hero.primary_lane === 'Roam' || b4Hero.primary_lane === 'Mid'));

  // Step 16 (B5 after Da Qiao picked B4) with top 3 mages banned must still pick a real Mid carry, never a 2nd Roam Support
  const haya = byName('Haya');
  const zhen = byName('Lady Zhen');
  const blueStep16 = [...blueStep15, daQiao.hero_id];
  const bans16 = [haya.hero_id, zhen.hero_id, wang.hero_id];
  const inf16 = runTournamentInference(blueStep16, redPicks, bans16, [], true, true, heroes, 16, null, null, true, synergy, []);
  const top5Mid = inf16.recommendations.slice(0, 5);
  assert.ok(
    top5Mid.every(rec => rec.hero.primary_role !== 'Support'),
    `Expected all top 5 Mid recommendations after Da Qiao to be non-Support, got ${top5Mid.map(r => r.hero.name).join(', ')}`
  );

  const dec16 = searchDraft(
    { step: 16, picks: { blue: blueStep16, red: redPicks }, bans: { blue: bans16, red: [] } },
    aiCtx,
    { budgetMs: 1200 }
  );
  const pickedB5 = heroes.find(h => h.hero_id === dec16.heroId);
  assert.ok(pickedB5 && pickedB5.primary_lane === 'Mid' && pickedB5.primary_role !== 'Support');
});

test('user real matches Game 1 and Game 2 regression: Red phase-1 ban prioritizes Ao\'yin B1 deny, and Team-based Fearless works in Game 3', () => {
  const byName = (n) => {
    const h = heroes.find((x) => x.name.toLowerCase() === n.toLowerCase());
    assert.ok(h, `Hero not found: ${n}`);
    return h;
  };

  // Game 1 Actual
  const g1BluePicks = ['Lapulapu', 'Zilong', 'Lorion', 'Charlotte', 'Flowborn (Marksman)'].map(byName);
  const g1RedPicks = ['Lian Po', 'Haya', 'Ying', 'Fatih', 'Marco Polo'].map(byName);
  const g1BlueBans = ['Guan Yu', 'Chano', 'Biron', 'Chicha'].map(byName);
  const g1RedBans = ['Dunshan', "Ao'yin", 'Florentino', 'Dharma'].map(byName);

  // Game 2 Actual (clarified ban: Red ban Florentino & Biron)
  const g2BluePicks = ['Zhang Fei', 'Pei', 'Mai Shiranui', 'Bai Qi', 'Di Renjie'].map(byName);
  const g2RedPicks = ['Dyadia', 'Dharma', 'Yuhuan', 'Chicha', 'Yang Jian'].map(byName);
  const g2BlueBans = ['Lapulapu', 'Guan Yu', 'Arli', 'Augran'].map(byName);
  const g2RedBans = ['Dunshan', "Ao'yin", 'Florentino', 'Biron'].map(byName);

  // Verify that on Step 1 / Step 3 (Red Ban Phase 1), Red denies Blue's top B1 target.
  // Nama hero TIDAK dikunci di sini: yang dijamin adalah invarian "Red mem-ban
  // opener yang sama dengan target B1 yang dipilih engine untuk Blue". Mengunci
  // nama membuat test rapuh begitu ranking opener berubah karena bukti baru.
  const rBlueBanStep0 = runTournamentInference([], [], [g1BlueBans[0].hero_id], [], false, true, heroes, 0, null, null, true, synergy, []);
  const blueOpener = heroes.find((h) => h.hero_id === rBlueBanStep0.phaseStrategy?.plannedOpener?.hero_id);
  assert.ok(blueOpener, 'Blue harus punya planned opener');
  const rRedBanStep1 = runTournamentInference([], [], [g1BlueBans[0].hero_id], [], false, false, heroes, 1, null, null, true, synergy, []);
  const topBan1 = rRedBanStep1.recommendations.slice(0, 3).map((r) => r.hero.name);
  assert.ok(
    topBan1.includes(blueOpener.name),
    `Red harus ban target B1 Blue (${blueOpener.name}), got: ${topBan1.join(', ')}`,
  );

  // Verify that Ao'yin B1 projection does not pair with archaic Cai Yan (recency threshold filtered)
  const rB1 = runTournamentInference([], [], [], [], true, true, heroes, 4, null, null, true, synergy, []);
  const aoyinRec = rB1.recommendations.find((r) => r.hero.name === "Ao'yin");
  assert.ok(aoyinRec, "Ao'yin should be recommended for B1 opener");
  assert.ok(!aoyinRec.projection?.bestCaseScenario?.includes('Cai Yan'), `Ao'yin projection should not recommend Cai Yan, got: ${aoyinRec.projection?.bestCaseScenario}`);

  // Test Series Fearless Per-Team:
  // Game 1: Blue = Team A, Red = Team B (Red wins)
  // Game 2: Blue = Team A, Red = Team B (Red wins)
  // Game 3: Losing team (Team A) becomes Blue or Red. Suppose Team B (winner) is on Blue in Game 3.
  const gamesMap = {
    1: {
      bluePicks: g1BluePicks,
      redPicks: g1RedPicks,
      blueBans: g1BlueBans,
      redBans: g1RedBans,
      draftStep: 18,
      bluePlanAId: null,
      bluePlanBId: null,
      redPlanAId: null,
      redPlanBId: null,
      blueTeam: 'A',
      winner: 'red',
    },
    2: {
      bluePicks: g2BluePicks,
      redPicks: g2RedPicks,
      blueBans: g2BlueBans,
      redBans: g2RedBans,
      draftStep: 18,
      bluePlanAId: null,
      bluePlanBId: null,
      redPlanAId: null,
      redPlanBId: null,
      blueTeam: 'A',
      winner: 'red',
    },
    3: {
      bluePicks: Array(5).fill(null),
      redPicks: Array(5).fill(null),
      blueBans: Array(4).fill(null),
      redBans: Array(4).fill(null),
      draftStep: 0,
      bluePlanAId: null,
      bluePlanBId: null,
      redPlanAId: null,
      redPlanBId: null,
      blueTeam: 'B', // Winner of Game 2 (Team B) is now on Blue Side in Game 3!
      winner: null,
    },
  };

  const locksG3 = computeSeriesFearlessLocks(gamesMap, 3, true);

  // Blue Side in Game 3 is Team B. Its locked heroes must be Team B's picks from Game 1 & 2 (Lian Po, Haya, Ying, Dyadia, etc.)
  assert.ok(locksG3.blue.has(byName('Lian Po').hero_id), "Blue in Game 3 (Team B) must have Lian Po locked");
  assert.ok(locksG3.blue.has(byName('Haya').hero_id), "Blue in Game 3 (Team B) must have Haya locked");
  assert.ok(locksG3.blue.has(byName('Dyadia').hero_id), "Blue in Game 3 (Team B) must have Dyadia locked");

  // Zilong was picked by Team A in Game 1, so Team B (now Blue) is allowed to pick Zilong in Game 3!
  assert.ok(!locksG3.blue.has(byName('Zilong').hero_id), "Team B (on Blue) can pick Zilong since only Team A used it");

  // Red Side in Game 3 is Team A. Its locked heroes must be Team A's picks from Game 1 & 2 (Lapulapu, Zilong, Zhang Fei, etc.)
  assert.ok(locksG3.red.has(byName('Zilong').hero_id), "Red in Game 3 (Team A) must have Zilong locked");
  assert.ok(locksG3.red.has(byName('Lapulapu').hero_id), "Red in Game 3 (Team A) must have Lapulapu locked");
  assert.ok(!locksG3.red.has(byName('Lian Po').hero_id), "Team A (on Red) can pick Lian Po since only Team B used it");
});

test('Flowborn single-hero equivalence rule across draft, bans, and fearless', () => {
  const ctx = context();
  // Verify all 5 flowborn IDs exist
  const flowbornIds = [581, 582, 583, 584, 585];
  assert.equal(FLOWBORN_HERO_IDS.size, 5);
  flowbornIds.forEach(id => assert.ok(isFlowborn(id), `Hero ${id} must be Flowborn`));
  assert.ok(!isFlowborn(155), 'Dun is not Flowborn');

  // 1. Advance to B1 pick (step 4: after 4 bans)
  let pos = advance(emptyPosition(), ctx, 4);
  assert.equal(pos.step, 4); // B1
  // Flowborn Tank (581) is legal to pick for Blue
  assert.ok(isLegalHero(pos, 581, ctx), 'Flowborn Tank should be legal at B1');
  assert.ok(isLegalHero(pos, 584, ctx), 'Flowborn Marksman should be legal at B1');

  // Blue picks Flowborn (Tank) #581 at B1
  pos = applyDraftAction(pos, { side: 'blue', action: 'pick', heroId: 581 }, ctx);
  assert.equal(pos.step, 5); // R1
  assert.deepEqual(pos.picks.blue, [581]);

  // Now for Red at R1: Flowborn Tank is illegal, AND all other 4 Flowborn roles are also illegal!
  assert.equal(isLegalHero(pos, 581, ctx), false, 'Flowborn Tank cannot be picked again');
  assert.equal(isLegalHero(pos, 582, ctx), false, 'Flowborn Mage cannot be picked after Blue picked Flowborn Tank');
  assert.equal(isLegalHero(pos, 583, ctx), false, 'Flowborn Assassin cannot be picked after Blue picked Flowborn Tank');
  assert.equal(isLegalHero(pos, 584, ctx), false, 'Flowborn Marksman cannot be picked after Blue picked Flowborn Tank');
  assert.equal(isLegalHero(pos, 585, ctx), false, 'Flowborn Roamer cannot be picked after Blue picked Flowborn Tank');

  // 2. Ban mutual exclusivity: if any Flowborn is banned, none can be picked or banned
  let banPos = emptyPosition(); // step 0: Blue Ban 1
  banPos = applyDraftAction(banPos, { side: 'blue', action: 'ban', heroId: 582 }, ctx); // Blue bans Flowborn Mage
  assert.equal(banPos.step, 1); // Red Ban 1
  // Red cannot ban or pick any Flowborn variant
  flowbornIds.forEach(fid => {
    assert.equal(isLegalHero(banPos, fid, ctx), false, `Flowborn ${fid} cannot be banned or picked once Flowborn Mage is banned`);
  });

  // 3. Fearless Draft Lock: picking any Flowborn locks ALL Flowborn variants for subsequent games
  const flowbornHero = heroes.find(h => h.hero_id === 584) || { hero_id: 584, name: 'Flowborn (Marksman)' };
  const mockGames = {
    1: {
      bluePicks: [flowbornHero, null, null, null, null],
      redPicks: Array(5).fill(null),
      blueBans: Array(4).fill(null),
      redBans: Array(4).fill(null),
      draftStep: 18,
      blueTeam: 'A',
      winner: null,
    },
    2: {
      bluePicks: Array(5).fill(null),
      redPicks: Array(5).fill(null),
      blueBans: Array(4).fill(null),
      redBans: Array(4).fill(null),
      draftStep: 0,
      blueTeam: 'A',
      winner: null,
    },
  };

  const g2Locks = computeSeriesFearlessLocks(mockGames, 2, true);
  // Team A was Blue in Game 1 and is Blue in Game 2.
  // ALL 5 Flowborn variants must be in Blue's fearless lock set for Game 2!
  flowbornIds.forEach(fid => {
    assert.ok(g2Locks.blue.has(fid), `Flowborn ${fid} must be locked for Team A in Game 2`);
  });
  // Team B (Red) did not pick Flowborn, so they must not be locked
  flowbornIds.forEach(fid => {
    assert.ok(!g2Locks.red.has(fid), `Flowborn ${fid} must NOT be locked for Team B in Game 2`);
  });
});

test('Double-pick window detection and Duet Package Recommendations', () => {
  // 1. Test getDoublePickWindow across tournament and ranked formats
  // Tournament Step 4 (B1): single
  const b1Win = getDoublePickWindow(4, 'tournament');
  assert.equal(b1Win.isDoublePickFirst, false);
  assert.equal(b1Win.isDoublePickSecond, false);

  // Tournament Step 5 (R1): double-pick first (partner is Step 6 / R2)
  const r1Win = getDoublePickWindow(5, 'tournament');
  assert.equal(r1Win.isDoublePickFirst, true);
  assert.equal(r1Win.isDoublePickSecond, false);
  assert.equal(r1Win.partnerStep, 6);
  assert.equal(r1Win.side, 'red');

  // Tournament Step 6 (R2): double-pick second
  const r2Win = getDoublePickWindow(6, 'tournament');
  assert.equal(r2Win.isDoublePickFirst, false);
  assert.equal(r2Win.isDoublePickSecond, true);
  assert.equal(r2Win.partnerStep, 5);

  // Tournament Step 7 (B2): double-pick first (partner is Step 8 / B3)
  const b2Win = getDoublePickWindow(7, 'tournament');
  assert.equal(b2Win.isDoublePickFirst, true);
  assert.equal(b2Win.partnerStep, 8);

  // Tournament Step 15 (B4): double-pick first (partner is Step 16 / B5)
  const b4Win = getDoublePickWindow(15, 'tournament');
  assert.equal(b4Win.isDoublePickFirst, true);
  assert.equal(b4Win.partnerStep, 16);

  // 2. Test runTournamentInference at Step 5 generates valid Duet Packages
  const res = runTournamentInference(
    [], // our: none yet
    [509], // enemy: Dunshan
    [140, 163, 515, 538],
    [],
    true,
    false, // Red side
    heroes,
    5, // step 5: R1 (isDoublePickFirst = true)
    null,
    null,
    true,
    synergy,
    [],
    'tournament'
  );

  assert.ok(Array.isArray(res.duetPackages), 'duetPackages must be an array');
  assert.ok(res.duetPackages.length >= 1 && res.duetPackages.length <= 3, 'Must return up to 3 duet packages');

  for (const pkg of res.duetPackages) {
    // Both heroes must be distinct
    assert.notEqual(pkg.primaryHero.hero_id, pkg.secondaryHero.hero_id, 'Pair heroes must not be identical');
    // Cannot contain two Flowborn roles
    const bothFlowborn = isFlowborn(pkg.primaryHero.hero_id) && isFlowborn(pkg.secondaryHero.hero_id);
    assert.equal(bothFlowborn, false, 'Duet cannot contain two Flowborn roles');
    // Must have archetype badge
    assert.ok(pkg.archetypeBadge.length > 0, 'Must have archetype badge');
    // Primary and secondary lanes must be specified
    assert.ok(pkg.primaryLane, 'Primary lane must be set');
    assert.ok(pkg.secondaryLane, 'Secondary lane must be set');
  }

  // 2b. POOL CONSISTENCY + LEGALITY: duet members must be a subset of the single-pick
  //     top-10 recommendations, and must never be picked/banned heroes on this board.
  const resBanIds = new Set([140, 163, 515, 538]);
  const resTop10 = res.recommendations.slice(0, 10).map(r => r.hero.hero_id);
  for (const pkg of res.duetPackages) {
    assert.ok(
      resTop10.includes(pkg.primaryHero.hero_id),
      `Duet primary ${pkg.primaryHero.name} must appear in the top-10 single-pick recommendations`
    );
    assert.ok(
      resTop10.includes(pkg.secondaryHero.hero_id),
      `Duet secondary ${pkg.secondaryHero.name} must appear in the top-10 single-pick recommendations`
    );
    assert.equal(pkg.primaryHero.hero_id === 509 || pkg.secondaryHero.hero_id === 509, false, 'Enemy pick Dunshan must not appear in a duet package');
    for (const bannedId of resBanIds) {
      assert.equal(pkg.primaryHero.hero_id === bannedId || pkg.secondaryHero.hero_id === bannedId, false, `Banned hero ${bannedId} must not appear in a duet package`);
    }
  }

  // 2c. DETERMINISM: identical inputs must produce identical packages (order, ids, lanes, score).
  const resAgain = runTournamentInference(
    [], // our: none yet
    [509], // enemy: Dunshan
    [140, 163, 515, 538],
    [],
    true,
    false, // Red side
    heroes,
    5, // step 5: R1 (isDoublePickFirst = true)
    null,
    null,
    true,
    synergy,
    [],
    'tournament'
  );
  assert.equal(resAgain.duetPackages.length, res.duetPackages.length, 'Deterministic re-run must emit the same number of duet packages');
  for (let i = 0; i < res.duetPackages.length; i++) {
    const a = res.duetPackages[i];
    const b = resAgain.duetPackages[i];
    assert.equal(a.primaryHero.hero_id, b.primaryHero.hero_id, `Package ${i} primary must be stable`);
    assert.equal(a.secondaryHero.hero_id, b.secondaryHero.hero_id, `Package ${i} secondary must be stable`);
    assert.equal(a.primaryLane, b.primaryLane, `Package ${i} primary lane must be stable`);
    assert.equal(a.secondaryLane, b.secondaryLane, `Package ${i} secondary lane must be stable`);
    assert.equal(a.archetypeBadge, b.archetypeBadge, `Package ${i} archetype badge must be stable`);
    assert.ok(Math.abs(a.combinedScore - b.combinedScore) <= 1e-9, `Package ${i} combinedScore must be deterministic (got ${a.combinedScore} vs ${b.combinedScore})`);
  }

  // 2d. LANE AVAILABILITY on a mid-draft board: Step 15 (B4, double-pick first) with three
  //     existing Blue picks and four Red picks. The duet lanes must be two DISTINCT lanes
  //     that are still VACANT for our team, computed with the SAME lane helper the engine
  //     uses (evaluateTeamCompositionIntegrity -> assignHeroLanes via kpl lane weights).
  const byLaneName = (n) => {
    const h = heroes.find(x => x.name === n);
    assert.ok(h, `Hero not found: ${n}`);
    return h;
  };
  const bluePicks15 = ['Kaizer', 'Marco Polo', 'Liang'].map(byLaneName);
  const redPicks15 = ['Lady Zhen', 'Lapulapu', 'Yixing', 'Fang'].map(byLaneName);
  const res15 = runTournamentInference(
    bluePicks15.map(h => h.hero_id),
    redPicks15.map(h => h.hero_id),
    [140, 163, 515, 538],
    [],
    true,
    true,
    heroes,
    15, // step 15: B4 (isDoublePickFirst = true, partner B5)
    null,
    null,
    true,
    synergy,
    [],
    'tournament'
  );
  const kplLaneRates = synergy?.hero_lane_rates || {};
  // Same derivation as the engine: our occupied lanes come from assignHeroLanes through
  // evaluateTeamCompositionIntegrity over our current picks.
  const ourOccupiedLanes = evaluateTeamCompositionIntegrity(bluePicks15, kplLaneRates).laneState.occupiedLanes;
  assert.equal(ourOccupiedLanes.size, 3, 'Fixture sanity: three picks with distinct primary lanes occupy three lanes');
  const pickedIds15 = new Set([...bluePicks15, ...redPicks15].map(h => h.hero_id));
  const bans15 = new Set([140, 163, 515, 538]);
  const top10Step15 = res15.recommendations.slice(0, 10).map(r => r.hero.hero_id);
  for (const pkg of res15.duetPackages) {
    assert.notEqual(pkg.primaryLane, pkg.secondaryLane, 'Duet members must occupy two distinct lanes');
    assert.equal(ourOccupiedLanes.has(pkg.primaryLane), false, `Duet primary lane ${pkg.primaryLane} must still be vacant for our team`);
    assert.equal(ourOccupiedLanes.has(pkg.secondaryLane), false, `Duet secondary lane ${pkg.secondaryLane} must still be vacant for our team`);
    assert.equal(pickedIds15.has(pkg.primaryHero.hero_id) || pickedIds15.has(pkg.secondaryHero.hero_id), false, 'No package member may already be picked');
    assert.equal(bans15.has(pkg.primaryHero.hero_id) || bans15.has(pkg.secondaryHero.hero_id), false, 'No package member may be banned');
    assert.ok(top10Step15.includes(pkg.primaryHero.hero_id) && top10Step15.includes(pkg.secondaryHero.hero_id), 'Step-15 duet members must also come from the single-pick top-10');
  }

  // 3. Non-double pick turn (e.g. Step 4 B1) should NOT generate duet packages
  const resB1 = runTournamentInference(
    [],
    [],
    [140, 163, 515, 538],
    [],
    true,
    true, // Blue side B1
    heroes,
    4, // Step 4: B1
    null,
    null,
    true,
    synergy,
    [],
    'tournament'
  );
  assert.deepEqual(resB1.duetPackages, [], 'Step 4 B1 single pick must not produce duet packages');
});

// =============================================================================
// BUKTI MATCHUP TERUKUR (KPL MEASURED MATCHUP EVIDENCE)
// -----------------------------------------------------------------------------
// Fixture dibuat inline: TIDAK bergantung pada isi dataset publik (lane data
// sedang diperbarui paralel oleh pipeline ml-engine).
// Aturan produk yang diuji: bukti terukur boleh MEMVETO atau MENIMBANG relasi
// counter kurasi, tetapi tidak pernah MEMBUAT relasi baru.
// =============================================================================

/** Hero fixture minimal dengan bentuk Hero yang dipakai mesin inferensi. */
function fixtureHero(overrides = {}) {
  return {
    hero_id: 900,
    name: 'Fixture Hero',
    chinese_name: 'Fixture',
    slug: 'fixture-hero',
    title: '',
    primary_role: 'Fighter',
    primary_lane: 'Clash',
    lanes: ['Clash'],
    popularity_band: null,
    win_rate: 0.5,
    win_rate_source: 'ranked',
    kpl_win_rate: null,
    kpl_matches: null,
    pick_rate: 0.05,
    ban_rate: 0.01,
    counters: [],
    countered_by: [],
    tactical_tips: '',
    counter_items: [],
    portrait_asset: '',
    kpl_id: null,
    is_global_exclusive: false,
    is_global_released: true,
    ...overrides,
  };
}

test('measured KPL evidence vetoes a curated counter', () => {
  const target = fixtureHero({ hero_id: 801, name: 'Target Hero', slug: 'target-hero' });
  const candidate = fixtureHero({
    hero_id: 800,
    name: 'Kandidat',
    slug: 'kandidat',
    counters: [{ target_id: 801, target_name: 'Target Hero', severity: 'hard', reason: 'suppress mematikan dash' }],
    measured_countered_by: [
      { counter_id: 801, counter_name: 'Target Hero', delta: -0.075, n: 117, source: 'kpl_measured' },
    ],
  });

  const evidence = counterEvidenceFor(candidate, target);
  assert.equal(evidence.curated, true, 'relasi kurasi harus terdeteksi');
  assert.equal(evidence.vetoed, true, 'delta -7,5 pp harus memveto relasi kurasi');
  assert.equal(evidence.isCounter, false, 'relasi yang diveto bukan counter lagi');
  assert.ok(evidence.measured, 'bukti terukur harus dikembalikan');
  assert.equal(evidence.measured.delta, -0.075, 'delta harus dikembalikan apa adanya (bertanda)');
  assert.equal(evidence.measured.n, 117);
});

test('measured evidence never creates a relation that was not curated', () => {
  const target = fixtureHero({ hero_id: 811, name: 'Target B', slug: 'target-b' });
  const candidate = fixtureHero({
    hero_id: 810,
    name: 'Kandidat B',
    slug: 'kandidat-b',
    counters: [],
    measured_counters: [
      { target_id: 811, target_name: 'Target B', delta: 0.12, n: 80, source: 'kpl_measured' },
    ],
  });

  const evidence = counterEvidenceFor(candidate, target);
  assert.equal(evidence.curated, false, 'tidak ada relasi kurasi');
  assert.equal(evidence.isCounter, false, 'bukti terukur tidak boleh membuat relasi counter baru');
  assert.equal(evidence.vetoed, false);
  assert.equal(evidence.measured.delta, 0.12);
});

test('measured evidence confirms a curated counter', () => {
  const target = fixtureHero({ hero_id: 821, name: 'Target C', slug: 'target-c' });
  const candidate = fixtureHero({
    hero_id: 820,
    name: 'Kandidat C',
    slug: 'kandidat-c',
    counters: [{ target_id: 821, target_name: 'Target C', severity: 'soft', reason: 'poke jarak jauh' }],
    measured_counters: [
      { target_id: 821, target_name: 'Target C', delta: 0.08, n: 80, source: 'kpl_measured' },
    ],
  });

  const evidence = counterEvidenceFor(candidate, target);
  assert.equal(evidence.curated, true);
  assert.equal(evidence.vetoed, false, 'delta +8 pp mengonfirmasi, bukan memveto');
  assert.equal(evidence.isCounter, true, 'relasi kurasi yang dikonfirmasi tetap counter');
  assert.equal(evidence.measured.delta, 0.08);
});

test('pairs below the sample gate are ignored', () => {
  const target = fixtureHero({ hero_id: 831, name: 'Target D', slug: 'target-d' });
  const candidate = fixtureHero({
    hero_id: 830,
    name: 'Kandidat D',
    slug: 'kandidat-d',
    counters: [{ target_id: 831, target_name: 'Target D', severity: 'hard', reason: 'kurasi' }],
    measured_counters: [
      { target_id: 831, target_name: 'Target D', delta: 0.12, n: MEASURED_MIN_SAMPLE - 1, source: 'kpl_measured' },
    ],
  });

  assert.equal(MEASURED_MIN_SAMPLE, 30, 'ambang sampel minimum harus 30 game');
  assert.equal(measuredMatchupBetween(candidate, 831), null, 'n = 29 harus diabaikan');
  const evidence = counterEvidenceFor(candidate, target);
  assert.equal(evidence.measured, null, 'tanpa bukti valid, mesin berperilaku seperti sebelumnya');
  assert.equal(evidence.isCounter, true, 'relasi kurasi tetap berlaku');
  assert.equal(evidence.vetoed, false);

  // Batas inklusif: n = 30 sudah dipakai.
  const atGate = fixtureHero({
    hero_id: 832,
    name: 'Kandidat E',
    slug: 'kandidat-e',
    measured_counters: [
      { target_id: 831, target_name: 'Target D', delta: 0.12, n: MEASURED_MIN_SAMPLE, source: 'kpl_measured' },
    ],
  });
  assert.deepEqual(measuredMatchupBetween(atGate, 831), { delta: 0.12, n: 30, weightedDelta: undefined });
});

test('measured term changes the ranking of otherwise identical candidates', () => {
  // Fixture ban-phase: kedua kandidat sama persis kecuali bukti KPL terukur.
  // Sisi biru dengan Plan A eksplisit -> cabang "ban counter opener" (+1,25) aktif.
  const planHero = fixtureHero({ hero_id: 904, name: 'Opener Rencana', slug: 'opener-rencana', primary_lane: 'Clash', lanes: ['Clash'] });

  // Relasi kurasi DITENTANG data KPL: bonus counter kurasi hilang (diveto).
  const vetoed = fixtureHero({
    hero_id: 901,
    name: 'Kandidat Veto',
    slug: 'kandidat-veto',
    primary_lane: 'Jungle',
    lanes: ['Jungle'],
    counters: [{ target_id: 904, target_name: 'Opener Rencana', severity: 'hard', reason: 'kurasi' }],
    measured_countered_by: [
      { counter_id: 904, counter_name: 'Opener Rencana', delta: -0.09, n: 140, source: 'kpl_measured' },
    ],
  });

  // Relasi kurasi DIDUKUNG data KPL: bonus kurasi + suku terukur kecil (0,08 x 0,8).
  const confirmed = fixtureHero({
    hero_id: 902,
    name: 'Kandidat Konfirmasi',
    slug: 'kandidat-konfirmasi',
    primary_lane: 'Jungle',
    lanes: ['Jungle'],
    counters: [{ target_id: 904, target_name: 'Opener Rencana', severity: 'hard', reason: 'kurasi' }],
    measured_counters: [
      { target_id: 904, target_name: 'Opener Rencana', delta: 0.08, n: 140, source: 'kpl_measured' },
    ],
  });

  const pool = [vetoed, confirmed, planHero];
  const result = runTournamentInference(
    [],            // ourHeroIds
    [],            // enemyHeroIds
    [],            // bannedHeroIds
    [],            // fearlessUnavailableIds
    false,         // isPickPhase = false -> BAN_PHASE_1
    true,          // isBlueSide
    pool,
    0,             // draftStep 0 -> BAN_PHASE_1
    904,           // planAId (opener terencana yang dilindungi)
    null,
    false,         // onlyGlobalReleased: fixture tanpa flag rilis
    {},            // synergyDb kosong
    [],
    'tournament'
  );

  const scores = new Map(result.recommendations.map(r => [r.hero.hero_id, r.choiceScore]));
  assert.ok(scores.has(901) && scores.has(902), 'kedua kandidat harus dievaluasi');
  assert.ok(
    scores.get(902) > scores.get(901),
    `kandidat terkonfirmasi data harus unggul (${scores.get(902)} vs ${scores.get(901)})`
  );
  // Selisih skor = paket bonus counter kurasi (1,25 + bobot hard-counter/160) + suku terukur
  // kecil (0,08 x 0,8 = 0,064). Kandidat yang diveto kehilangan SELURUH paket bonus itu.
  const gap = scores.get(902) - scores.get(901);
  assert.ok(gap > 1.25, `selisih skor harus memuat bonus counter kurasi (gap=${gap})`);
  assert.ok(gap <= 1.25 + 0.55 + 0.08 + 1e-9, `suku terukur harus kecil, bukan dominan (gap=${gap})`);
});

test('pre-ban count is a draft pattern, never a counter relation', () => {
  // `top_prebans` = hero yang di-ban fase-1 oleh tim itu SENDIRI sebelum first-pick-nya
  // (mis. 102x Guan Yu di-ban sebelum Blue first-pick Dunshan). Itu pola draft, bukan
  // matchup. Kalau pola ini diperlakukan sebagai "counter", ban list memunculkan relasi
  // yang tidak pernah ada (dulu Guan Yu masuk top-3 ban dengan alasan palsu).
  const ban = runTournamentInference([], [], [], [], false, true, heroes, 0, null, null, true, synergy);
  const opener = heroes.find((h) => h.hero_id === ban.phaseStrategy?.plannedOpener?.hero_id);
  assert.ok(opener, 'harus ada planned opener');
  const claimsCounter = ban.recommendations.filter((r) => (r.proComboTag ?? '').includes('Amankan B1'));
  for (const rec of claimsCounter) {
    const slug = (s) => String(s).replace(/-/g, '').toLowerCase();
    const curated =
      rec.hero.counters?.some((c) => c.target_id === opener.hero_id) ||
      opener.countered_by?.some((c) => c.counter_id === rec.hero.hero_id) ||
      rec.hero.hokfire_counters?.strong_against?.some((s) => slug(s) === slug(opener.slug)) ||
      opener.hokfire_counters?.weak_against?.some((s) => slug(s) === slug(rec.hero.slug));
    assert.ok(
      curated,
      `Ban "${rec.hero.name}" mengklaim counter ke ${opener.name} tanpa relasi kurasi/HOKFIRE`,
    );
  }
});

test('planned B1 opener must rest on real B1 evidence, not a tiny sample', () => {
  // Zilong pernah jadi opener #1 hanya karena 10 game B1 dengan win rate 79,6%.
  // Rekam jejak first-pick tanpa sampel cukup tidak boleh jadi alasan utama.
  const b1 = runTournamentInference([], [], [], [], true, true, heroes, 4, null, null, true, synergy);
  const opener = heroes.find((h) => h.hero_id === b1.phaseStrategy?.plannedOpener?.hero_id);
  assert.ok(opener, 'harus ada planned opener');
  const presence = kplPresenceOf(opener.hero_id, synergy.b1_openers ?? {});
  assert.ok(
    (presence?.b1Recent ?? 0) >= 40,
    `opener ${opener.name} hanya punya ${Math.round(presence?.b1Recent ?? 0)} game B1 (12 bln) — sampel terlalu tipis`,
  );
});
