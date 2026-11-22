import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_SCALE_VECTORS,
  HERO_DIMENSION_VECTORS,
  evaluateScaleClash,
  evaluateBacklineSafety,
  detectConstraintRemovalSynergies,
  detectEnemyTempoImpostors,
  evaluateSuicidalDiverTrap,
  evaluateDaQiaoFrontlineSynergy,
  evaluateZeroDisengageExploitation,
  evaluateDiveCoreTriadEnabler,
} from '../src/engine/scaleDimensionTactics.ts';

// Helper mock hero
function makeMockHero(heroId, name, role, primaryLane, tags = {}) {
  return {
    hero_id: heroId,
    name,
    primary_role: role,
    roles: [role],
    primary_lane: primaryLane,
    lanes: [primaryLane],
    counters: [],
    countered_by: [],
    tactical_profile: {
      tags: { ...tags },
    },
  };
}

test('scale vectors and dimension vectors are normalized ~1.0', () => {
  for (const [id, vec] of Object.entries(HERO_SCALE_VECTORS)) {
    const sum = vec.duel + vec.skirmish + vec.teamfight;
    assert.ok(
      Math.abs(sum - 1.0) < 0.01,
      `Hero ${id} scale vector sum is ${sum}, expected ~1.0`
    );
  }

  for (const [id, vec] of Object.entries(HERO_DIMENSION_VECTORS)) {
    const sum = vec.poke + vec.dive + vec.peel;
    assert.ok(
      Math.abs(sum - 1.0) < 0.01,
      `Hero ${id} dimension vector sum is ${sum}, expected ~1.0`
    );
  }
});

test('scale clash evaluation correctly identifies split push vs teamfight brawl', () => {
  // Tim Kita: Duelist & Split Push (Fuzi 139, Mi Yue 121, Pei 502, Shouyue 196, Da Qiao 191)
  const ourHeroes = [
    makeMockHero(139, 'Fuzi', 'Fighter', 'Clash', { kite_vulnerable: true }),
    makeMockHero(121, 'Mi Yue', 'Mage', 'Clash', { dive_vulnerable: false }),
    makeMockHero(502, 'Pei', 'Assassin', 'Jungle', { mobility: true }),
    makeMockHero(196, 'Shouyue', 'Marksman', 'Farm', { dive_vulnerable: true }),
    makeMockHero(191, 'Da Qiao', 'Support', 'Roam', { teleport: true }),
  ];

  // Musuh: 5v5 Mass Teamfight Brawl (Lu Bu 123, Lian Po 105, Lady Zhen 127, Huang Zhong 192, Zhang Fei 171)
  const enemyHeroes = [
    makeMockHero(123, 'Lu Bu', 'Fighter', 'Clash', { frontline: true }),
    makeMockHero(105, 'Lian Po', 'Tank', 'Clash', { cc_knockup: true, frontline: true }),
    makeMockHero(127, 'Lady Zhen', 'Mage', 'Mid', { cc_stun: true }),
    makeMockHero(192, 'Huang Zhong', 'Marksman', 'Farm', { dive_vulnerable: true }),
    makeMockHero(171, 'Zhang Fei', 'Tank', 'Roam', { cc_knockback: true, frontline: true }),
  ];

  const analysis = evaluateScaleClash(ourHeroes, enemyHeroes);

  assert.equal(analysis.enemyDominantScale, 'TEAMFIGHT_BRAWL');
  assert.equal(analysis.isSplitPushViable, true);
  assert.match(analysis.tacticalAdvice, /1-3-1 atau 4-1/);
});

test('backline safety check triggers CRITICAL when heavy divers face unprotected immobile carry', () => {
  // Tim Kita: Immobile Marksman (Garo 508) & Immobile Mage (Lady Zhen 127) dengan sedikit peel (Mulan 142, Kaizer 193, Sakeer 534)
  const ourHeroes = [
    makeMockHero(508, 'Garo', 'Marksman', 'Farm', { dive_vulnerable: true, kite_vulnerable: true }),
    makeMockHero(127, 'Lady Zhen', 'Mage', 'Mid', { dive_vulnerable: true }),
    makeMockHero(142, 'Mulan', 'Fighter', 'Clash', { mobility: true }),
    makeMockHero(193, 'Kaizer', 'Fighter', 'Jungle', { frontline: true }),
    makeMockHero(534, 'Sakeer', 'Support', 'Roam', { ally_heal: true }),
  ];

  // Musuh: Heavy Dive squad (Han Xin 150, Mai Shiranui 157, Wukong 167, Sun Ce 510, Liu Shan 114)
  const enemyHeroes = [
    makeMockHero(150, 'Han Xin', 'Assassin', 'Jungle', { mobility: true, dash: true }),
    makeMockHero(157, 'Mai Shiranui', 'Mage', 'Mid', { dash: true, burst: true }),
    makeMockHero(167, 'Wukong', 'Assassin', 'Jungle', { mobility: true }),
    makeMockHero(510, 'Sun Ce', 'Fighter', 'Clash', { mobility: true, cc_knockup: true }),
    makeMockHero(114, 'Liu Shan', 'Tank', 'Roam', { cc_stun: true }),
  ];

  const safety = evaluateBacklineSafety(ourHeroes, enemyHeroes);

  assert.equal(safety.riskLevel, 'CRITICAL');
  assert.ok(safety.warningMessage?.includes('RISIKO KOLAPS LINI BELAKANG'));
  assert.ok(safety.threatDivers.length >= 3);
  assert.ok(safety.vulnerableCarries.some((c) => c.name === 'Garo'));
});

test('constraint removal synergies detect Sun Bin + Kaizer and Yaria + Lam', () => {
  const heroes = [
    makeMockHero(118, 'Sun Bin', 'Support', 'Roam', {}),
    makeMockHero(193, 'Kaizer', 'Fighter', 'Clash', {}),
    makeMockHero(505, 'Yaria', 'Support', 'Roam', {}),
    makeMockHero(528, 'Lam', 'Assassin', 'Jungle', {}),
  ];

  const synergies = detectConstraintRemovalSynergies(heroes);

  assert.ok(synergies.some((s) => s.enabler.hero_id === 118 && s.beneficiary.hero_id === 193));
  assert.ok(synergies.some((s) => s.enabler.hero_id === 505 && s.beneficiary.hero_id === 528));
});

test('enemy tempo impostors detect Da Qiao and Sun Bin counter-tactics', () => {
  const enemyHeroes = [
    makeMockHero(191, 'Da Qiao', 'Support', 'Roam', {}),
    makeMockHero(118, 'Sun Bin', 'Support', 'Roam', {}),
  ];

  const tactics = detectEnemyTempoImpostors(enemyHeroes);
  assert.equal(tactics.length, 2);
  assert.ok(tactics.some((t) => t.counterStrategy.includes('KONTRA DA QIAO')));
  assert.ok(tactics.some((t) => t.counterStrategy.includes('KONTRA SUN BIN')));
});

test('suicidal diver trap catches Gao Changgong against Liang suppression + heavy peelers', () => {
  const enemyHeroes = [
    makeMockHero(111, 'Lady Sun', 'Marksman', 'Farm', {}),
    makeMockHero(156, 'Liang', 'Mage', 'Mid', {}),
    makeMockHero(517, 'Augran', 'Fighter', 'Jungle', {}),
    makeMockHero(135, 'Xiang Yu', 'Tank', 'Clash', {}),
    makeMockHero(171, 'Zhang Fei', 'Tank', 'Roam', {}),
  ];

  const gaoChanggong = makeMockHero(153, 'Gao Changgong', 'Assassin', 'Jungle', { mobility: true });
  const trapGao = evaluateSuicidalDiverTrap(gaoChanggong, enemyHeroes);
  assert.equal(trapGao.isTrapped, true);
  assert.ok(trapGao.reason?.includes('Jebakan Kuncian Mutlak'));
  assert.ok(trapGao.penalty > 1.0);

  // Li Bai memiliki frame untargetable, jadi tidak boleh terjebak trap
  const liBai = makeMockHero(131, 'Li Bai', 'Assassin', 'Jungle', { mobility: true });
  const trapLiBai = evaluateSuicidalDiverTrap(liBai, enemyHeroes);
  assert.equal(trapLiBai.isTrapped, false);
});

test('Da Qiao frontline deficit synergy boosts Bruiser and penalizes Stealth solo assassin', () => {
  const ourHeroes = [
    makeMockHero(123, 'Lu Bu', 'Fighter', 'Clash', { frontline: true }),
    makeMockHero(191, 'Da Qiao', 'Support', 'Roam', {}),
    makeMockHero(177, 'Chano', 'Marksman', 'Farm', {}),
    makeMockHero(124, 'Zhou Yu', 'Mage', 'Mid', {}),
  ];

  const kaizer = makeMockHero(193, 'Kaizer', 'Fighter', 'Jungle', { frontline: true });
  const gao = makeMockHero(153, 'Gao Changgong', 'Assassin', 'Jungle', {});

  const kaizerSyn = evaluateDaQiaoFrontlineSynergy(kaizer, ourHeroes);
  assert.ok(kaizerSyn.scoreAdjustment > 0);
  assert.ok(kaizerSyn.tacticalTag?.includes('Elevator Engine'));

  const gaoSyn = evaluateDaQiaoFrontlineSynergy(gao, ourHeroes);
  assert.ok(gaoSyn.scoreAdjustment < 0);
  assert.ok(gaoSyn.tacticalTag?.includes('Antitesis'));
});

test('zero-disengage exploitation dynamically rewards heavy divers against unprotected backline', () => {
  // Musuh: Shouyue (carry rentan) + Dyadia (roamer enchanter tanpa disengage) + Charlotte + Augran
  const enemyHeroes = [
    makeMockHero(196, 'Shouyue', 'Marksman', 'Farm', { dive_vulnerable: true }),
    makeMockHero(577, 'Dyadia', 'Support', 'Roam', { ally_heal: true }),
    makeMockHero(536, 'Charlotte', 'Fighter', 'Clash', { frontline: true }),
    makeMockHero(517, 'Augran', 'Fighter', 'Jungle', { mobility: true }),
  ];

  const lapulapu = makeMockHero(168, 'Lapulapu', 'Tank', 'Roam', { engage: true, cc_knockup: true, frontline: true });
  const biron = makeMockHero(503, 'Biron', 'Fighter', 'Clash', { engage: true, cc_knockup: true, frontline: true });

  // Lapulapu & Biron harus mendapat dorongan eksploitasi dive
  const lapuExploit = evaluateZeroDisengageExploitation(lapulapu, [], enemyHeroes);
  assert.equal(lapuExploit.isApplicable, true);
  assert.ok(lapuExploit.scoreAdjustment >= 0.25);
  assert.ok(lapuExploit.tacticalTag?.includes('Eksploitasi Dive'));

  const bironExploit = evaluateZeroDisengageExploitation(biron, [], enemyHeroes);
  assert.equal(bironExploit.isApplicable, true);
  assert.ok(bironExploit.scoreAdjustment >= 0.25);

  // Jika musuh memiliki Zhuangzi (disengage murni), eksploitasi tidak berlaku
  const enemyWithZhuangzi = [
    ...enemyHeroes.filter((h) => h.hero_id !== 577),
    makeMockHero(113, 'Zhuangzi', 'Support', 'Roam', { disengage: true, ally_cleanse: true }),
  ];
  const lapuVsZhuangzi = evaluateZeroDisengageExploitation(lapulapu, [], enemyWithZhuangzi);
  assert.equal(lapuVsZhuangzi.isApplicable, false);
});

test('dive core triad enabler dynamically boosts area sustain mid and penalizes fragile solo assassin', () => {
  // Tim kita sudah memiliki 2 diver agresif (Pei 502 + Biron 503)
  const ourHeroes = [
    makeMockHero(502, 'Pei', 'Assassin', 'Jungle', { mobility: true, engage: true }),
    makeMockHero(503, 'Biron', 'Fighter', 'Clash', { frontline: true, engage: true, cc_knockup: true }),
  ];

  // Yuhuan (Mage dengan ally_heal & untargetable) harus mendapat dorongan sinergi triad
  const yuhuan = makeMockHero(176, 'Yuhuan', 'Mage', 'Mid', { ally_heal: true, cc_slow: true });
  const triadYuhuan = evaluateDiveCoreTriadEnabler(yuhuan, ourHeroes);
  assert.equal(triadYuhuan.isApplicable, true);
  assert.ok(triadYuhuan.scoreAdjustment > 0);
  assert.ok(triadYuhuan.tacticalTag?.includes('Sinergi Triad'));

  // Mai Shiranui (Mage assassin solo tipis tanpa heal/shield/peel) terkena penalti defisit sustain
  const mai = makeMockHero(157, 'Mai Shiranui', 'Mage', 'Mid', { mobility: true, dash: true });
  const triadMai = evaluateDiveCoreTriadEnabler(mai, ourHeroes);
  assert.equal(triadMai.isApplicable, true);
  assert.ok(triadMai.scoreAdjustment < 0);
  assert.ok(triadMai.tacticalTag?.includes('Defisit Sustain'));
});
