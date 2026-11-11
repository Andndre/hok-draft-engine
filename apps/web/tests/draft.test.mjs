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
} from '../src/engine/draftRules.ts';
import { rankedCandidates, searchDraft, evaluatePosition } from '../src/engine/draftSearch.ts';
import { evaluateTacticalScores, evaluateEnemyCounterExposure, reviewedHoKStatsBonuses, runTournamentInference } from '../src/engine/tournamentInference.ts';
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
