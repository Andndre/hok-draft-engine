import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignHeroLanes } from '../src/engine/draftRules.ts';
import {
  buildDefaultLaneAssignments,
  computeTempoComparison,
  evaluateLaneMatchup,
  generatePostDraftGamePlan,
  suggestBeneficialLaneSwaps,
  swapAssignedLanes,
} from '../src/engine/gamePlan.ts';

const read = p => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const synergy = read(manifest.artifacts.synergy.file);
const globalHeroes = heroes.filter(h => h.is_global_released === true && h.hero_id !== 511);

const heroByName = name => {
  const found = globalHeroes.find(h => h.name === name);
  assert.ok(found, `Global hero "${name}" should exist in dataset`);
  return found;
};

const withTags = (base, overrides, tagOverrides = {}) => ({
  ...base,
  ...overrides,
  counters: overrides.counters ?? [],
  countered_by: overrides.countered_by ?? [],
  kpl_matchup: undefined,
  hokstats_guide: undefined,
  tactical_profile: {
    tags: {
      ...(base.tactical_profile?.tags ?? {}),
      ...tagOverrides,
    },
  },
});

test('assignHeroLanes honors official flex and clean KPL flex rates without distorting non-flex lanes', () => {
  const base = globalHeroes[0];
  const kplRates = {
    '9001': {
      Clash: { games: 40, wins: 22, win_rate: 0.55, share: 0.55 },
      Jungle: { games: 32, wins: 18, win_rate: 0.5625, share: 0.45 },
    },
    '9002': {
      Clash: { games: 60, wins: 31, win_rate: 0.517, share: 1.0 },
    },
  };
  const flexKplHero = withTags(base, { hero_id: 9001, name: 'FlexKpl', primary_lane: 'Clash', lanes: ['Clash'] });
  const pureClash = withTags(base, { hero_id: 9002, name: 'PureClash', primary_lane: 'Clash', lanes: ['Clash'] });
  const mid = withTags(base, { hero_id: 9003, name: 'PureMid', primary_lane: 'Mid', lanes: ['Mid'] });
  const farm = withTags(base, { hero_id: 9004, name: 'PureFarm', primary_lane: 'Farm', lanes: ['Farm'] });
  const roam = withTags(base, { hero_id: 9005, name: 'PureRoam', primary_lane: 'Roam', lanes: ['Roam'] });

  const result = assignHeroLanes([flexKplHero, pureClash, mid, farm, roam], kplRates);
  assert.equal(result.occupiedLanes.size, 5);
  assert.equal(result.byLane.Jungle, 9001, 'KPL flex (>=20g, >=15% share) should slide into open Jungle');
  assert.equal(result.byLane.Clash, 9002);

  // Real KPL dataset checks: clean post-2024 lane rates exist & Da Qiao reflects Mid+Roam while Marco Polo stays Farm
  const daQiao = heroByName('Da Qiao');
  const marco = heroByName('Marco Polo');
  const dqRates = synergy.hero_lane_rates?.[String(daQiao.hero_id)];
  const mpRates = synergy.hero_lane_rates?.[String(marco.hero_id)];
  assert.ok(dqRates?.Roam && dqRates?.Mid, 'Da Qiao KPL lane rates include both Mid and Roam');
  assert.ok(mpRates?.Farm && !mpRates?.Roam, 'Marco Polo is Farm-only without pre-2024 Roam noise');
});

test('Roam 2v2 context neutralizes hard solo Farm loss (TERTOLONG_ROAM) and avoids unnecessary tactical swaps', () => {
  const template = globalHeroes[0];
  const allyClash = withTags(template, { hero_id: 9101, name: 'AllyClash', primary_lane: 'Clash', lanes: ['Clash'], primary_role: 'Fighter' });
  const allyJungle = withTags(template, { hero_id: 9102, name: 'AllyJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Assassin' });
  const allyMid = withTags(template, { hero_id: 9103, name: 'AllyMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' });
  const enemyClash = withTags(template, { hero_id: 9201, name: 'EnemyClash', primary_lane: 'Clash', lanes: ['Clash'], primary_role: 'Fighter' });
  const enemyJungle = withTags(template, { hero_id: 9202, name: 'EnemyJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Assassin' });
  const enemyMid = withTags(template, { hero_id: 9203, name: 'EnemyMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' });
  const enemyFarm = withTags(template, { hero_id: 9204, name: 'EnemyFarm', primary_lane: 'Farm', lanes: ['Farm'], primary_role: 'Marksman' });
  const enemyRoam = withTags(template, { hero_id: 9205, name: 'EnemyRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' });

  const allyFarm = withTags(template, {
    hero_id: 9104,
    name: 'AllyFarm',
    primary_lane: 'Farm',
    lanes: ['Farm'],
    primary_role: 'Marksman',
    countered_by: [{ counter_id: 9204, counter_name: 'EnemyFarm', severity: 'soft', reason: 'Outrange di lane' }],
  });

  const passiveRoam = withTags(template, { hero_id: 9105, name: 'PassiveRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Tank' });
  const soloKalah = evaluateLaneMatchup('Farm', allyFarm, enemyFarm, passiveRoam, enemyRoam);
  assert.equal(soloKalah.verdict, 'KALAH');

  const healerPeelRoam = withTags(
    template,
    { hero_id: 9106, name: 'HealerPeelRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' },
    { ally_heal: true, ally_shield: true, peel: true, disengage: true }
  );
  const proPairs = {
    '9104_9106': { matches: 35, wins: 22, win_rate: 0.629 },
  };
  const savedByRoam = evaluateLaneMatchup('Farm', allyFarm, enemyFarm, healerPeelRoam, enemyRoam, undefined, proPairs);
  assert.equal(savedByRoam.verdict, 'TERTOLONG_ROAM');
  assert.ok(savedByRoam.roamContextNote?.includes('Konteks 2v2 Roam'));

  const ourHeroesSaved = [allyClash, allyJungle, allyMid, allyFarm, healerPeelRoam];
  const enemyHeroes = [enemyClash, enemyJungle, enemyMid, enemyFarm, enemyRoam];
  const ourAssign = buildDefaultLaneAssignments(ourHeroesSaved);
  const enemyAssign = buildDefaultLaneAssignments(enemyHeroes);
  const suggestionsWhenSaved = suggestBeneficialLaneSwaps(ourAssign, enemyAssign, ourHeroesSaved, enemyHeroes, undefined, proPairs);
  assert.equal(suggestionsWhenSaved.length, 0, 'Saved 2v2 lane should not trigger costly non-flex tactical swap');
});

test('tactical non-flex swap reports macro penalties, 04:00 re-swap guidance, and blocks non-jungler Jungle swap', () => {
  const template = globalHeroes[0];
  const allyClash = withTags(template, {
    hero_id: 9301,
    name: 'AntiMarksmanFighter',
    primary_lane: 'Clash',
    lanes: ['Clash'],
    primary_role: 'Fighter',
    counters: [{ target_id: 9404, target_name: 'EnemyFarm', severity: 'hard', reason: 'Gap close burst' }],
  }, { dash: true, mobility: true, engage: true });
  const allyJungle = withTags(template, { hero_id: 9302, name: 'AllyJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Assassin' });
  const allyMid = withTags(template, { hero_id: 9303, name: 'AllyMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' });
  const allyFarm = withTags(template, {
    hero_id: 9304,
    name: 'HardCounteredFarm',
    primary_lane: 'Farm',
    lanes: ['Farm'],
    primary_role: 'Marksman',
    countered_by: [{ counter_id: 9404, counter_name: 'EnemyFarm', severity: 'hard', reason: 'Burst combo' }],
    counters: [{ target_id: 9401, target_name: 'EnemyClash', severity: 'hard', reason: 'Kite melee' }],
  });
  const allyRoam = withTags(template, { hero_id: 9305, name: 'AllyRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' });

  const enemyClash = withTags(template, { hero_id: 9401, name: 'EnemyClash', primary_lane: 'Clash', lanes: ['Clash'], primary_role: 'Fighter' });
  const enemyJungle = withTags(template, { hero_id: 9402, name: 'EnemyJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Assassin' });
  const enemyMid = withTags(template, { hero_id: 9403, name: 'EnemyMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' });
  const enemyFarm = withTags(template, { hero_id: 9404, name: 'EnemyFarm', primary_lane: 'Farm', lanes: ['Farm'], primary_role: 'Marksman' });
  const enemyRoam = withTags(template, { hero_id: 9405, name: 'EnemyRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' });

  const ourHeroes = [allyClash, allyJungle, allyMid, allyFarm, allyRoam];
  const enemyHeroes = [enemyClash, enemyJungle, enemyMid, enemyFarm, enemyRoam];
  const defaultAssign = buildDefaultLaneAssignments(ourHeroes);
  const enemyAssign = buildDefaultLaneAssignments(enemyHeroes);

  const suggestions = suggestBeneficialLaneSwaps(defaultAssign, enemyAssign, ourHeroes, enemyHeroes);
  assert.ok(suggestions.some(s => (s.laneA === 'Clash' && s.laneB === 'Farm') || (s.laneA === 'Farm' && s.laneB === 'Clash')), 'Proposes Clash <-> Farm swap when both matchups flip');
  assert.ok(suggestions.every(s => s.laneA !== 'Jungle' && s.laneB !== 'Jungle'), 'Never proposes moving non-jungler into Jungle');

  const swapped = swapAssignedLanes(defaultAssign, 'Clash', 'Farm');
  const postSwapPlan = generatePostDraftGamePlan({
    ourSide: 'blue',
    ourHeroes,
    enemyHeroes,
    ourAssignmentOverride: swapped,
    enemyAssignmentOverride: enemyAssign,
  });
  const swappedFarmEval = postSwapPlan.laneMatchups.find(m => m.lane === 'Farm');
  assert.equal(swappedFarmEval?.swapFeasibility, 'TACTICAL_SWAP');
  assert.ok((swappedFarmEval?.macroCost ?? 0) > 0);
  assert.ok(swappedFarmEval?.reswapAdvice?.includes('04:00'));
  assert.ok(postSwapPlan.activeReswapAlerts.some(text => text.includes('04:00')));

  // Forced invalid non-jungler into Jungle triggers SWAP_BERISIKO
  const badJungleSwap = swapAssignedLanes(defaultAssign, 'Jungle', 'Mid');
  const badPlan = generatePostDraftGamePlan({
    ourSide: 'blue',
    ourHeroes,
    enemyHeroes,
    ourAssignmentOverride: badJungleSwap,
    enemyAssignmentOverride: enemyAssign,
  });
  const badJungleEval = badPlan.laneMatchups.find(m => m.lane === 'Jungle');
  assert.equal(badJungleEval?.verdict, 'SWAP_BERISIKO');
  assert.ok((badJungleEval?.macroCost ?? 0) >= 2.0);
});

test('jungle plan switches to anti-invade Split-Map Vertical Trade vs Lv1-2 invaders and includes Trio Gold-Sharing Pra-04:00', () => {
  const base = globalHeroes[0];
  const ourHeroes = [
    withTags(base, { hero_id: 9501, name: 'WeakClash', primary_lane: 'Clash', lanes: ['Clash'], primary_role: 'Tank' }),
    withTags(base, { hero_id: 9502, name: 'ScalingJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Assassin' }, { weak_early: true }),
    withTags(base, { hero_id: 9503, name: 'ScalingMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' }, { weak_early: true }),
    withTags(base, { hero_id: 9504, name: 'ScalingFarm', primary_lane: 'Farm', lanes: ['Farm'], primary_role: 'Marksman' }, { weak_early: true }),
    withTags(base, { hero_id: 9505, name: 'DefensiveRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' }, { weak_early: true, peel: true }),
  ];
  const enemyHeroes = [
    withTags(base, { hero_id: 9601, name: 'EnemyClash', primary_lane: 'Clash', lanes: ['Clash'], primary_role: 'Fighter' }, { engage: true }),
    withTags(base, { hero_id: 9602, name: 'InvadeJungle', primary_lane: 'Jungle', lanes: ['Jungle'], primary_role: 'Fighter' }, { weak_early: false, engage: true, mobility: true }),
    withTags(base, { hero_id: 9603, name: 'SuppressMid', primary_lane: 'Mid', lanes: ['Mid'], primary_role: 'Mage' }, { weak_early: false, suppress: true }),
    withTags(base, { hero_id: 9604, name: 'EnemyFarm', primary_lane: 'Farm', lanes: ['Farm'], primary_role: 'Marksman' }),
    withTags(base, { hero_id: 9605, name: 'HookRoam', primary_lane: 'Roam', lanes: ['Roam'], primary_role: 'Support' }, { weak_early: false, cc_pull: true, engage: true }),
  ];

  const guardedPlan = generatePostDraftGamePlan({ ourSide: 'blue', ourHeroes, enemyHeroes });
  assert.equal(guardedPlan.junglePlan.openingPosture, 'SAFE_SPLIT_OR_GUARD');
  assert.ok(guardedPlan.junglePlan.invadeRiskReasons.length >= 2);
  assert.ok(guardedPlan.junglePlan.openingSummary.includes('Split-Map Vertical Trade'));
  assert.ok(guardedPlan.junglePlan.trioGoldSharingPlan.includes('Gold-Sharing Pra-04:00'));
  assert.ok(guardedPlan.junglePlan.trioGoldSharingPlan.includes('100%'));
  assert.ok(['Tyrant', 'Overlord'].includes(guardedPlan.junglePlan.objectiveFocusAt4Min.primaryObjective));
});

test('tempo comparison uses 105+15 hybrid KPL empirical curves plus profile estimate fallback for low-sample heroes', () => {
  const arke = heroByName('Arke');
  const simaYi = heroByName('Sima Yi');
  const marco = heroByName('Marco Polo');
  const liang = heroByName('Liang');
  const augran = heroByName('Augran');
  const ladySun = heroByName('Lady Sun');
  const dun = heroByName('Dun');
  const haya = heroByName('Haya');
  const dyadia = heroByName('Dyadia');
  const zhangFei = heroByName('Zhang Fei');

  const kplCurves = synergy.hero_tempo_curves || {};
  const empiricalGlobalCount = globalHeroes.filter(h => (kplCurves[String(h.hero_id)]?.total_games ?? 0) >= 15).length;
  assert.ok(empiricalGlobalCount >= 100, `Expected >=100 Global heroes with >=15 KPL games, got ${empiricalGlobalCount}`);

  const comp = computeTempoComparison(
    [dun, arke, simaYi, marco, dyadia],
    [augran, haya, liang, ladySun, zhangFei],
    kplCurves
  );
  const byId = new Map(comp.ours.heroes.map(h => [h.hero.hero_id, h]));
  assert.equal(byId.get(arke.hero_id)?.sourceKind, 'profile_estimate', 'Arke falls back to profile estimate');
  assert.equal(byId.get(simaYi.hero_id)?.sourceKind, 'profile_estimate', 'Sima Yi falls back to profile estimate');
  assert.equal(byId.get(marco.hero_id)?.sourceKind, 'kpl_empirical', 'Marco Polo uses empirical KPL curve');
  assert.equal(comp.ours.kplSampleCount + comp.ours.profileEstimatedCount, 5);
});

test('never proposes tactical pre-04:00 swaps involving Roam or non-flex roles (e.g. Wang Zhaojun <-> Dyadia)', () => {
  const blueHeroes = ["Ao'yin", 'Cai Yan', 'Biron', 'Xiao Qiao', 'Ying'].map(heroByName);
  const redHeroes = ['Dyadia', 'Arli', 'Lu Bu', 'Wang Zhaojun', 'Zilong'].map(heroByName);
  const blueSwap = swapAssignedLanes(buildDefaultLaneAssignments(blueHeroes, synergy.hero_lane_rates), 'Clash', 'Farm');
  const redSwap = swapAssignedLanes(buildDefaultLaneAssignments(redHeroes, synergy.hero_lane_rates), 'Clash', 'Farm');

  const redPlan = generatePostDraftGamePlan({
    ourSide: 'red',
    ourHeroes: redHeroes,
    enemyHeroes: blueHeroes,
    synergy,
    ourAssignmentOverride: redSwap,
    enemyAssignmentOverride: blueSwap,
  });

  assert.equal(
    redPlan.swapSuggestions.some(s => s.laneA === 'Roam' || s.laneB === 'Roam' || s.laneA === 'Jungle' || s.laneB === 'Jungle'),
    false,
    'Never suggest moving non-flex Mid/Farm/Clash into Roam or Jungle for 00:00-04:00 swap'
  );
  assert.equal(redPlan.swapSuggestions.length, 0);

  // If manually tested: Dyadia (Roam-only) forced into Mid triggers SWAP_BERISIKO,
  // while Wang Zhaojun keeps OFFICIAL_FLEX because her lanes include ['Mid', 'Roam'].
  const manualMidRoam = swapAssignedLanes(redSwap, 'Mid', 'Roam');
  const manualPlan = generatePostDraftGamePlan({
    ourSide: 'red',
    ourHeroes: redHeroes,
    enemyHeroes: blueHeroes,
    synergy,
    ourAssignmentOverride: manualMidRoam,
    enemyAssignmentOverride: blueSwap,
  });
  const midEval = manualPlan.laneMatchups.find(m => m.lane === 'Mid');
  const roamEval = manualPlan.laneMatchups.find(m => m.lane === 'Roam');
  assert.equal(midEval?.verdict, 'SWAP_BERISIKO');
  assert.ok((midEval?.macroCost ?? 0) >= 3.0);
  assert.equal(roamEval?.swapFeasibility, 'OFFICIAL_FLEX');

  // Non-Roam hero (e.g. Arli) manually moved into Roam triggers SWAP_BERISIKO
  const nonRoamSwap = swapAssignedLanes(buildDefaultLaneAssignments(redHeroes, synergy.hero_lane_rates), 'Farm', 'Roam');
  const nonRoamPlan = generatePostDraftGamePlan({
    ourSide: 'red',
    ourHeroes: redHeroes,
    enemyHeroes: blueHeroes,
    synergy,
    ourAssignmentOverride: nonRoamSwap,
  });
  const nonRoamEval = nonRoamPlan.laneMatchups.find(m => m.lane === 'Roam');
  assert.equal(nonRoamEval?.verdict, 'SWAP_BERISIKO');
  assert.ok((nonRoamEval?.macroCost ?? 0) >= 3.5);
});

test('tempo relative shares always sum to 100% without double rounding and use KPL curves for Global roster', () => {
  const redScreenshot = ['Dyadia', 'Lu Bu', 'Lady Sun', 'Lady Zhen', 'Musashi'].map(heroByName);
  const blueOpp = ["Ao'yin", 'Cai Yan', 'Biron', 'Xiao Qiao', 'Ying'].map(heroByName);
  const kplCurves = synergy.hero_tempo_curves || {};

  const realComp = computeTempoComparison(redScreenshot, blueOpp, kplCurves);
  for (const key of ['early', 'mid', 'late']) {
    const share = realComp.relativeShares[key];
    assert.equal(share.oursShare + share.enemyShare, 100, `Expected ${key} relative shares to sum to 100`);
  }
  assert.equal(realComp.ours.kplSampleCount, 5, 'Dyadia, Lu Bu, Lady Sun, Lady Zhen, Musashi all have >=15 KPL games');

  // Reproduces screenshot raw averages (49 vs 50, 51 vs 51, 50 vs 52) plus unrounded boundary (0.494 vs 0.496)
  const base = globalHeroes[0];
  const ourTeam = [9701, 9702, 9703, 9704, 9705].map((id, i) => ({ ...base, hero_id: id, name: `Our${i}` }));
  const enemyTeam = [9801, 9802, 9803, 9804, 9805].map((id, i) => ({ ...base, hero_id: id, name: `Enemy${i}` }));
  const makeCurve = (heroId, earlyWr, midWr, lateWr) => [
    String(heroId),
    {
      total_games: 100,
      avg_duration_sec: 1020,
      profile: 'balanced',
      early: { games: 30, win_rate: earlyWr },
      mid: { games: 40, win_rate: midWr },
      late: { games: 30, win_rate: lateWr },
    },
  ];
  const syntheticCurves = Object.fromEntries([
    ...ourTeam.map(h => makeCurve(h.hero_id, 0.49, 0.51, 0.50)),
    ...enemyTeam.map(h => makeCurve(h.hero_id, 0.50, 0.51, 0.52)),
  ]);

  const normalized = computeTempoComparison(ourTeam, enemyTeam, syntheticCurves);
  assert.deepEqual(normalized.relativeShares.early, {
    oursShare: 49,
    enemyShare: 51,
    ourAvgPct: 49,
    enemyAvgPct: 50,
  });
  assert.deepEqual(normalized.relativeShares.mid, {
    oursShare: 50,
    enemyShare: 50,
    ourAvgPct: 51,
    enemyAvgPct: 51,
  });
  assert.deepEqual(normalized.relativeShares.late, {
    oursShare: 49,
    enemyShare: 51,
    ourAvgPct: 50,
    enemyAvgPct: 52,
  });

  // Unrounded check: 0.494 vs 0.496 rounds to 50% vs 50% (whereas pre-rounded 49 vs 50 would skew 49% vs 51%)
  const unroundedCurves = Object.fromEntries([
    ...ourTeam.map(h => makeCurve(h.hero_id, 0.494, 0.62, 0.42)),
    ...enemyTeam.map(h => makeCurve(h.hero_id, 0.496, 0.41, 0.58)),
  ]);
  const unroundedComp = computeTempoComparison(ourTeam, enemyTeam, unroundedCurves);
  assert.equal(unroundedComp.relativeShares.early.oursShare, 50);
  assert.equal(unroundedComp.relativeShares.early.enemyShare, 50);
  assert.equal(unroundedComp.relativeShares.mid.oursShare + unroundedComp.relativeShares.mid.enemyShare, 100);
  assert.equal(unroundedComp.relativeShares.late.oursShare + unroundedComp.relativeShares.late.enemyShare, 100);
});
